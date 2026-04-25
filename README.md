# Rugpull Bakery Telegram Bot

Бот умеет показывать актуальную payout-модель активного сезона Rugpull Bakery и делать `/ch` по игроку в активном сезоне.

## Как считается

1. Бот читает live `agent.json`, чтобы понять активную игровую модель сезона.
2. Бот читает `leaderboard.getActiveSeason`, чтобы взять `prizePool`.
3. Для legacy-сезонов с payout по bakery balance бот считает стоимость `1,000` cookies по текущему распределению.
4. Для solo-сезонов бот показывает breakdown leaderboard/activity payout по текущему пулу.
5. Для нового division-сезона бот показывает bucket’ы `Standard leaderboard / Standard activity / Open leaderboard` и считает `/ch` по division-specific payout table.

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
- В solo-сезонах `/ch` считает leaderboard reward по текущему rank игрока.
- В division-сезоне `/ch` определяет bakery division (`Standard` или `Open`) и считает leaderboard reward по актуальной payout table этой division.
- Для `Standard activity` бот не оценивает per-player reward, потому что публичные docs не раскрывают размер activity tiers.
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

Это запасной fallback на случай, если бот не смог получить точные on-chain fee. При желании можно переопределить через `.env`:

```bash
BAKE_TX_FEE_ETH=0.00000675
```
