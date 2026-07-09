/**
 * Envía un mensaje de Telegram al chat_id del usuario. Si no hay TELEGRAM_BOT_TOKEN
 * configurado, o el usuario no tiene telegram_chat_id guardado, se omite silenciosamente
 * (el email sigue siendo el canal garantizado).
 */
async function enviarTelegramAlerta(chatId, texto) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    console.log('\n📱 [telegram.service] TELEGRAM_BOT_TOKEN no configurado — se omite el envío.');
    return { simulado: true };
  }

  if (!chatId) {
    console.log('[telegram.service] Usuario sin telegram_chat_id configurado — se omite el envío.');
    return { omitido: true };
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: texto,
      parse_mode: 'HTML',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error enviando mensaje de Telegram: HTTP ${response.status} — ${errorBody}`);
  }

  return response.json();
}

module.exports = { enviarTelegramAlerta };
