import ranges from "@/lib/meta-ranges.json";

/**
 * Is this address inside Meta's own network? Meta announces its ranges
 * under AS32934; the list here is that announcement, baked in. Whatever a
 * request from there calls itself — a crawler, a phone, Safari — it is
 * Meta looking, and it gets the page a crawler gets.
 *
 * Refresh: whois -h whois.radb.net -- '-i origin AS32934' | grep -E '^route6?:'
 */
type Range = { v: 4 | 6; net: bigint; bits: number };

function v4(ip: string): bigint | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = BigInt(0);
  for (const s of p) {
    const b = Number(s);
    if (!/^\d{1,3}$/.test(s) || b > 255) return null;
    n = (n << BigInt(8)) | BigInt(b);
  }
  return n;
}

function v6(ip: string): bigint | null {
  if (!ip.includes(":")) return null;
  const [head, tail = ""] = ip.split("::");
  const hs = head ? head.split(":") : [];
  const ts = tail ? tail.split(":") : [];
  if (ip.includes("::") ? hs.length + ts.length > 7 : hs.length !== 8) return null;
  const groups = [...hs, ...Array(8 - hs.length - ts.length).fill("0"), ...ts];
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return n;
}

const META: Range[] = (ranges as string[]).flatMap((r) => {
  const [addr, bitsStr] = r.split("/");
  const bits = Number(bitsStr);
  const six = addr.includes(":");
  const net = six ? v6(addr) : v4(addr);
  if (net == null || !Number.isFinite(bits)) return [];
  const width = six ? 128 : 32;
  return [{ v: six ? 6 : 4, net: net >> BigInt(width - bits), bits }];
});

export function isMetaNetwork(ip: string): boolean {
  if (!ip) return false;
  // An IPv4 address handed over as ::ffff:a.b.c.d.
  const plain = ip.replace(/^::ffff:/i, "");
  const six = plain.includes(":");
  const n = six ? v6(plain) : v4(plain);
  if (n == null) return false;
  const width = six ? 128 : 32;
  for (const r of META) {
    if ((r.v === 6) !== six) continue;
    if (n >> BigInt(width - r.bits) === r.net) return true;
  }
  return false;
}
