import { writeFile } from "node:fs/promises";
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
const path = ".env.push.generated";
await writeFile(path, `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:your-contact@example.com\n`,
  { flag: "wx", mode: 0o600 });
console.log(`VAPID keys written to ignored ${path}. Keep the file private and set a real VAPID_SUBJECT.`);
