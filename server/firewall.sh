#!/bin/sh
# Firewall for the bots' computers (network «opencrew-pcs», interface oc-pcs). Run as root; safe to repeat.
# They can browse the internet, but not: the server itself, private/internal addresses (other services,
# cloud metadata), or the email ports (so nobody can send spam from this server).
set -e
CHAIN=OPENCREW-PCS
iptables -N $CHAIN 2>/dev/null || true
iptables -F $CHAIN
for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 127.0.0.0/8 224.0.0.0/4 0.0.0.0/8; do
  iptables -A $CHAIN -d "$net" -j DROP
done
iptables -A $CHAIN -p tcp -m multiport --dports 25,465,587,2525 -j DROP
iptables -A $CHAIN -p udp --dport 25 -j DROP
iptables -A $CHAIN -j RETURN
# Traffic from the computers to anywhere goes through our chain first.
iptables -C DOCKER-USER -i oc-pcs -j $CHAIN 2>/dev/null || iptables -I DOCKER-USER -i oc-pcs -j $CHAIN
# And they can't open connections to the server itself (SSH, Docker, anything listening).
iptables -C INPUT -i oc-pcs -m conntrack --ctstate NEW -j DROP 2>/dev/null || iptables -I INPUT -i oc-pcs -m conntrack --ctstate NEW -j DROP
echo "Cortafuegos de los ordenadores de bots aplicado."
