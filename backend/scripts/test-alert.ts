/**
 * Manda un mensaje de prueba al grupo de Telegram de las alertas, con TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID del entorno.
 *
 *   pnpm test:alert
 */
import { telegramSender } from "@hm/shared";

const send = telegramSender();
if (!send) {
  console.error("Faltan TELEGRAM_BOT_TOKEN y/o TELEGRAM_CHAT_ID en .env");
  process.exit(1);
}
const ok = await send(`🧪 [prueba · ${process.env.NETWORK ?? "mainnet"}] Las alertas de JackTrade llegan a este grupo.`);
console.log(ok ? "Mandado. Fijate en el grupo de Telegram." : "Telegram no lo aceptó: revisá el token y el chat id");
process.exit(ok ? 0 : 1);
