#!/bin/sh
# Run on nlabs.live as: sudo sh ~/sites/setup-biblia-narrada.sh
set -e
cp /home/nlabs/sites/biblia-narrada.nginx /etc/nginx/sites-available/biblia-narrada
ln -sf /etc/nginx/sites-available/biblia-narrada /etc/nginx/sites-enabled/biblia-narrada
nginx -t
systemctl reload nginx
echo "nginx ok. Testing HTTP..."
curl -s -o /dev/null -w "biblia: %{http_code}\n" -H "Host: biblia.nlabs.live" http://127.0.0.1/pt/
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 443/tcp; fi
certbot --nginx -d biblia.nlabs.live -d bible.nlabs.live --redirect
nginx -t && systemctl reload nginx
echo "Done: https://biblia.nlabs.live  https://bible.nlabs.live"
