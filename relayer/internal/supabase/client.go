// Package supabase wraps the Supabase REST client for Tessera state persistence (R-84, R-110).
package supabase

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
)

// Client is a thin wrapper around the Supabase REST API.
type Client struct {
	projectURL string
	serviceKey string
	http       *http.Client
}

// New returns a Client configured from the given project URL and service-role key.
func New(projectURL, serviceKey string) *Client {
	return &Client{
		projectURL: projectURL,
		serviceKey: serviceKey,
		http:       &http.Client{},
	}
}

// Ping verifies the Supabase project is reachable by calling the health endpoint.
func (c *Client) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.projectURL+"/rest/v1/", nil)
	if err != nil {
		return fmt.Errorf("supabase ping: build request: %w", err)
	}
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("supabase ping: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("supabase ping: unexpected status %d", resp.StatusCode)
	}
	slog.Info("supabase reachable", "project", c.projectURL, "status", resp.StatusCode)
	return nil
}
