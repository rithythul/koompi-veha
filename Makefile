VERSION := $(shell grep '^version' Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/')
ARCH := $(shell uname -m)
DIST := dist

.PHONY: all server edge dashboard clean

all: server edge

# ── Server release (veha-api binary + dashboard static files) ──────────

server: dashboard
	@echo "Building veha-api (release)..."
	cargo build --release -p veha-api
	@mkdir -p $(DIST)
	@rm -rf $(DIST)/veha-server-$(ARCH)
	@mkdir -p $(DIST)/veha-server-$(ARCH)/static
	cp target/release/veha-api $(DIST)/veha-server-$(ARCH)/
	cp -r veha-dashboard/dist/* $(DIST)/veha-server-$(ARCH)/static/
	cd $(DIST) && tar czf veha-server-$(VERSION)-$(ARCH).tar.gz veha-server-$(ARCH)
	@echo "Server tarball: $(DIST)/veha-server-$(VERSION)-$(ARCH).tar.gz"

# ── Edge release (veha-agent + veha-player with framebuffer) ───────────

edge:
	@echo "Building veha-agent + veha-player (release, framebuffer)..."
	cargo build --release -p veha-agent -p veha-player --features framebuffer
	@mkdir -p $(DIST)
	@rm -rf $(DIST)/veha-edge-$(ARCH)
	@mkdir -p $(DIST)/veha-edge-$(ARCH)
	cp target/release/veha-agent $(DIST)/veha-edge-$(ARCH)/
	cp target/release/veha-player $(DIST)/veha-edge-$(ARCH)/
	cd $(DIST) && tar czf veha-edge-$(VERSION)-$(ARCH).tar.gz veha-edge-$(ARCH)
	@echo "Edge tarball: $(DIST)/veha-edge-$(VERSION)-$(ARCH).tar.gz"

# ── Dashboard SPA ─────────────────────────────────────────────────────

dashboard:
	@echo "Building dashboard..."
	cd veha-dashboard && bun install --frozen-lockfile && bun run build

# ── Cleanup ───────────────────────────────────────────────────────────

clean:
	rm -rf $(DIST)
	cargo clean
