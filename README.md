# Rugpull Bakery Telegram Bot

Бот считает стоимость `1,000` печенек для топ-5 команд Rugpull Bakery исходя из текущего общего пула наград в ETH и умеет делать `/ch` по игроку в активном сезоне.

## Как считается

1. Бот читает live `agent.json`, чтобы взять `cookieScale`.
2. Бот читает `leaderboard.getActiveSeason`, чтобы взять `prizePool`.
3. Бот читает `leaderboard.getTopBakeries`, чтобы взять топ команд и их `cookieBalance`.
4. Cookies для команды = `cookieBalance / cookieScale`.
5. Если сезон не вернул `payoutStructureBps`, используется схема топ-5: `50% / 20% / 15% / 10% / 5%`.
6. Стоимость `1,000` cookies = `teamPrizeEth / teamCookies * 1000`.

## Запуск

```bash
cp .env.example .env
```

Заполни `TELEGRAM_BOT_TOKEN` токеном от `@BotFather`, затем экспортируй переменные и запусти:

```bash
set -a
source .env
set +a
npm start
```

Команды в Telegram:

```text
/start
/help
/cookies
/value
/price
/ch
```

## Команда `/ch`

Сценарий:

1. Отправляешь `/ch`
2. Бот просит `username` из игры или `wallet address`
3. Бот показывает:
   - текущий клан игрока
   - сколько у него cookies
   - сколько `Bake`-транзакций найдено
   - сколько примерно ушло на gas
   - `est. reward` по текущей формуле для активного сезона
   - текущий `ROI`
   - и по умолчанию отправляет это как image card, а не как текст

Что важно:

- `/ch` сейчас считает по активному сезону.
- В группах бот ждет ответ только от того пользователя, который вызвал `/ch`, и безопаснее всего отвечать reply на prompt бота.
- Можно сразу отправить `/ch username` или `/ch 0x...` в одном сообщении.
- Если клан не входит в топ-5, `est. reward` будет `0`, потому что формула завязана на текущий top-5 prize split.
- `Cook tx` считается по on-chain `Bake`-логам bakery-контракта для адреса и сезона.
- `Gas cost` считается из этого количества `Bake`-транзакций и средней комиссии по реальным `Bake` receipts.
- Если генерация или отправка картинки не удалась, бот автоматически делает fallback на текстовое сообщение.

## Проверка без Telegram

```bash
npm run once
```

Если CoinGecko временно недоступен, бот все равно покажет значение в ETH. Для фиксированного USD-курса можно задать `ETH_USD_FALLBACK`, например:

```bash
ETH_USD_FALLBACK=2194 npm run once
```

## Bake Fee Fallback

Для будущего расчета `/ch` в боте зафиксирован fallback комиссии одного `bake`:

```text
0.00000675 ETH
```

Он взят из нескольких реальных транзакций `Bake` на Abscan. При желании можно переопределить через `.env`:

```bash
BAKE_TX_FEE_ETH=0.00000675
```
