// Package relayer — admin HTTP server for demo scenario fault injection.
//
// Only enabled when --admin flag is set on `tessera relayer`.
// Endpoints:
//
//	POST /admin/inject-fault?type=wrong_fingerprint&duration=1  — make next submission send wrong fingerprint
//	POST /admin/go-silent?nonces=1                              — skip submission for N nonces
//	POST /admin/status                                          — report current relayer state
package relayer

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// AdminState holds the current fault injection configuration.
// All fields are guarded by mu.
type AdminState struct {
	mu                    sync.Mutex
	wrongFingerprint      bool
	wrongFingerprintUntil time.Time
	silentNonces          int
}

// AdminServer returns an *http.Server for the admin API bound to addr.
// The server shares state with the Runner so fault flags are visible to
// the submission goroutines in P-7.
func (r *Runner) AdminServer(addr string) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/admin/inject-fault", r.handleInjectFault)
	mux.HandleFunc("/admin/go-silent", r.handleGoSilent)
	mux.HandleFunc("/admin/status", r.handleAdminStatus)
	return &http.Server{Addr: addr, Handler: mux}
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
