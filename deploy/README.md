# Orbit Proposal deployment

The DNS A record for `orbit-proposals.unwhelm.net` should point to `204.12.245.235`.

On the VPS, after cloning this repository to `/home/administrator/node-sites/OrbitProposals`, run:

```bash
sudo bash /home/administrator/node-sites/OrbitProposals/deploy/install-orbit-proposals.sh
```

The script installs the static site, creates the Nginx server block, reloads Nginx, and runs Certbot with HTTP-to-HTTPS redirect and renewal-safe flags.
