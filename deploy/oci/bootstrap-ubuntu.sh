#!/usr/bin/env bash
# Initial installation for Ubuntu 24.04 ARM64 OCI instance.
# Run once via sudo, after logging in through SSH with an authorized key.
set -Eeuo pipefail
if [[ "$(id -u)" != "0" ]]; then
  echo "Run as root: sudo bash deploy/oci/bootstrap-ubuntu.sh" >&2
  exit 1
fi
if [[ "$(dpkg --print-architecture)" != "arm64" ]]; then
  echo "Expected Oracle Ampere A1 (arm64), not $(dpkg --print-architecture)" >&2
  exit 1
fi
. /etc/os-release
if [[ "$ID" != ubuntu ]]; then
  echo "Only Ubuntu is supported by this bootstrap script." >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git gnupg unattended-upgrades
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
systemctl enable --now unattended-upgrades
docker compose version
echo "Docker is ready. Do not add your SSH user to the docker group (root-equivalent)."
echo "Next: configure deploy/oci/secrets.env with mode 600, then run the preflight."
