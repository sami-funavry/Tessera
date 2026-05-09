// Package relayer — admin HTTP server for demo scenario fault injection
// and platform healthcheck.
//
// Only enabled when --admin flag is set on `tessera relayer`.
// Endpoints:
//
//	GET  /admin/health                                          — unauthenticated healthcheck for platforms (Railway, Fly, k8s)
//	POST /admin/inject-fault?type=wrong_fingerprint&duration=1  — make next submission send wrong fingerprint
//	POST /admin/go-silent?nonces=1                              — skip submission for N nonces
//	POST /admin/force-frivolous?nonces=1                        — force challenger to file baseless dispute (S-4)
//	POST /admin/status                                          — report current relayer state
package relayer

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

// AdminState holds the current fault injection configuration.
// All fields are guarded by mu.
type AdminState struct {
	mu                     sync.Mutex
	wrongFingerprint       bool
	wrongFingerprintUntil  time.Time
	silentNonces           int
	forceFrivolousNonces   int // S-4: challenger files baseless dispute for N pending submissions
}

// AdminServer returns an *http.Server for the admin API bound to addr.
// Requires the X-Admin-Secret header to match the TESSERA_ADMIN_SECRET env var
// when that env var is set. Set TESSERA_ADMIN_SECRET before starting the relayer
// in any non-localhost deployment.
//
// /admin/health is the only unauthenticated endpoint. CORS is set when
// FRONTEND_ORIGIN is configured so the deployed Next.js can call /admin/* from
// its server-side API routes.
func (r *Runner) AdminServer(addr string) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/admin/health", r.withCORS(r.handleHealth))
	mux.HandleFunc("/admin/inject-fault", r.withCORS(r.checkAdminSecret(r.handleInjectFault)))
	mux.HandleFunc("/admin/go-silent", r.withCORS(r.checkAdminSecret(r.handleGoSilent)))
	mux.HandleFunc("/admin/force-frivolous", r.withCORS(r.checkAdminSecret(r.handleForceFrivolous)))
	mux.HandleFunc("/admin/status", r.withCORS(r.checkAdminSecret(r.handleAdminStatus)))
	return &http.Server{Addr: addr, Handler: mux}
}

// withCORS adds CORS headers when FRONTEND_ORIGIN is set, allowing the deployed
// Next.js API routes to proxy to the relayer admin endpoints. Handles OPTIONS
// preflight inline.
func (r *Runner) withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		origin := os.Getenv("FRONTEND_ORIGIN")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Secret")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if req.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, req)
	}
}

// handleHealth is an unauthenticated readiness probe. Returns 200 with the
// relayer's identity. Used by Railway/Fly/k8s to determine if the container
// is up. Does not check chain connectivity (that would make the probe flap on
// transient RPC outages); the deeper /admin/status endpoint covers that.
func (r *Runner) handleHealth(w http.ResponseWriter, _ *http.Request) {
	body := map[string]any{
		"status":  "ok",
		"service": "tessera-relayer",
	}
	if r.cfg.RelayerAddr != "" {
		body["relayer_addr"] = r.cfg.RelayerAddr
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

// checkAdminSecret wraps a handler with a shared-secret check.
// When TESSERA_ADMIN_SECRET is set, requests must supply the matching value in
// the X-Admin-Secret header. Unset = no check (local dev / demo only).
func (r *Runner) checkAdminSecret(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		secret := os.Getenv("TESSERA_ADMIN_SECRET")
		if secret != "" && req.Header.Get("X-Admin-Secret") != secret {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, req)
	}
}

// handleInjectFault enables wrong-fingerprint fault injection for `duration` messages.
//
//	POST /admin/inject-fault?type=wrong_fingerprint&duration=1
func (r *Runner) handleInjectFault(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	faultType := req.URL.Query().Get("type")
	duration, _ := strconv.Atoi(req.URL.Query().Get("duration"))
	if duration <= 0 {
		duration = 1
	}

	r.admin.mu.Lock()
	if faultType == "wrong_fingerprint" {
		r.admin.wrongFingerprint = true
		r.admin.wrongFingerprintUntil = time.Now().Add(time.Duration(duration) * time.Minute)
	}
	r.admin.mu.Unlock()

	slog.Info("admin: inject-fault activated", "type", faultType, "duration_min", duration)
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"status":"ok","type":%q,"duration_min":%d}`, faultType, duration)
}

// handleGoSilent instructs the relayer to skip submission for nonces messages.
//
//	POST /admin/go-silent?nonces=1
func (r *Runner) handleGoSilent(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	nonces, _ := strconv.Atoi(req.URL.Query().Get("nonces"))
	if nonces <= 0 {
		nonces = 1
	}

	r.admin.mu.Lock()
	r.admin.silentNonces = nonces
	r.admin.mu.Unlock()

	slog.Info("admin: go-silent activated", "nonces", nonces)
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"status":"ok","nonces":%d}`, nonces)
}

// handleAdminStatus reports the current relayer address and fault state.
//
//	GET/POST /admin/status
func (r *Runner) handleAdminStatus(w http.ResponseWriter, req *http.Request) {
	r.admin.mu.Lock()
	wrongFP := r.admin.wrongFingerprint && time.Now().Before(r.admin.wrongFingerprintUntil)
	silent := r.admin.silentNonces
	r.admin.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"status":"ok","relayer_addr":%q,"wrong_fingerprint_active":%v,"silent_nonces_remaining":%d}`,
		r.cfg.RelayerAddr, wrongFP, silent)
}

// IsSilent reports whether the admin state indicates the next submission should be
// skipped. Decrements the counter atomically. Used by the submitter goroutine in P-7.
func (r *Runner) IsSilent() bool {
	r.admin.mu.Lock()
	defer r.admin.mu.Unlock()
	if r.admin.silentNonces > 0 {
		r.admin.silentNonces--
		return true
	}
	return false
}

// HasWrongFingerprintFault reports whether the wrong-fingerprint fault is currently active.
// Used by the submitter goroutine in P-7.
func (r *Runner) HasWrongFingerprintFault() bool {
	r.admin.mu.Lock()
	defer r.admin.mu.Unlock()
	if r.admin.wrongFingerprint && time.Now().After(r.admin.wrongFingerprintUntil) {
		r.admin.wrongFingerprint = false
	}
	return r.admin.wrongFingerprint
}

// handleForceFrivolous instructs the challenger to file a baseless dispute for N pending submissions (S-4).
//
//	POST /admin/force-frivolous?nonces=1
func (r *Runner) handleForceFrivolous(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	nonces, _ := strconv.Atoi(req.URL.Query().Get("nonces"))
	if nonces <= 0 {
		nonces = 1
	}

	r.admin.mu.Lock()
	r.admin.forceFrivolousNonces = nonces
	r.admin.mu.Unlock()

	slog.Info("admin: force-frivolous activated", "nonces", nonces)
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"status":"ok","nonces":%d}`, nonces)
}

// IsForceFrivolous reports whether the challenger should file a baseless dispute (S-4).
// Decrements the counter atomically — one-shot per call.
func (r *Runner) IsForceFrivolous() bool {
	r.admin.mu.Lock()
	defer r.admin.mu.Unlock()
	if r.admin.forceFrivolousNonces > 0 {
		r.admin.forceFrivolousNonces--
		return true
	}
	return false
}

// ─── Programmatic setters (used by tessera test-scenario and unit tests) ─────

// SetWrongFingerprint enables or disables the wrong-fingerprint fault directly.
func (r *Runner) SetWrongFingerprint(active bool) {
	r.admin.mu.Lock()
	defer r.admin.mu.Unlock()
	r.admin.wrongFingerprint = active
	if active {
		r.admin.wrongFingerprintUntil = time.Now().Add(10 * time.Minute)
	}
}

// SetSilentNonces sets the number of events to silently skip.
func (r *Runner) SetSilentNonces(n int) {
	r.admin.mu.Lock()
	defer r.admin.mu.Unlock()
	r.admin.silentNonces = n
}

// SetForceFrivolous sets the number of pending submissions for which the challenger
// will file a baseless dispute.
func (r *Runner) SetForceFrivolous(n int) {
	r.admin.mu.Lock()
	defer r.admin.mu.Unlock()
	r.admin.forceFrivolousNonces = n
}
