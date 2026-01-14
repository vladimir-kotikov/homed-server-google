#!/bin/bash
set -e

echo "Installing Homed Service Cloud..."

# Add Homed APT repository
apt-get update
apt-get install -y wget gnupg

# Add GPG key
wget -O /etc/apt/trusted.gpg.d/homed.asc https://apt.homed.dev/apt.key

# Add repository
echo "deb https://apt.homed.dev/ debian main" > /etc/apt/sources.list.d/homed.list

# Update and install homed-cloud
apt-get update
apt-get install -y homed-cloud

echo "Homed Service Cloud installed successfully"

# Wait for config file to be ready
while [ ! -f /etc/homed/cloud.conf ]; do
    echo "Waiting for configuration file..."
    sleep 1
done

echo "Starting Homed Service Cloud client..."
exec homed-cloud -c /etc/homed/cloud.conf
