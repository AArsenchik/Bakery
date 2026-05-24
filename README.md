# Rugpull Bakery Telegram Bot

Бот показывает актуальную payout-модель активного сезона Rugpull Bakery и делает `/ch` по игроку в активном сезоне.

## Как считается

1. Бот читает live `agent.json`, чтобы понять активную игровую модель сезона.
2. Бот читает `leaderboard.getActiveSeason`, чтобы взять текущий `prizePool`.
3. Для legacy-сезонов с payout по bakery balance бот считает стоимость `1,000` cookies по текущему распределению.
4. Для solo-сезонов бот показывает breakdown leaderboard/activity payout по текущему пулу.
5. Для division-сезона бот показывает bucket'ы `Standard leaderboard / Standard activity / Open leaderboard` и считает `/ch` по division-specific payout table.
6. Для Season 5/6 бот использует score-share модель: топ-10 bakeries делят 100% prize pool по доле bakery score, а внутри bakery reward делится по доле member score contribution.
7. Для Season 6 бот учитывает live `agent.json`: Grouped/Open bakery tiers, 50-member grouped bakeries, 5-block grouped bake cooldown, Open 1-block cadence, shared upgrades and random events.

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
/cookie
/ch
```

Кнопки в Telegram:

- `📊 My stats` - показывает статистику сохраненного аккаунта.
- `🔎 Check player` - просит username/address и проверяет любого игрока.
- `🍪 Rewards` - показывает текущий reward breakdown сезона.
- `💾 Save account` - сохраняет username/address за Telegram user id.
- `🗑 Forget account` - удаляет сохраненный аккаунт.

## Команда `/ch`

Сценарий:

1. Отправляешь `/ch`
2. Бот просит `username` из игры или `wallet address`
3. Бот показывает:
   - текущую bakery игрока
   - сколько у него cookies
   - сколько `Bake`-транзакций найдено
   - сколько ушло на gas
   - `est. reward` по текущей формуле для активного сезона
   - текущий `ROI`
   - и по умолчанию отправляет это как image card, а не как текст

Что важно:

- `/ch` сейчас считает по активному сезону.
- В группах бот ждет ответ только от того пользователя, который вызвал `/ch`, и безопаснее всего отвечать reply на prompt бота.
- Можно сразу отправить `/ch username` или `/ch 0x...` в одном сообщении.
- Чтобы не вводить username каждый раз, нажми `💾 Save account` один раз, а потом используй `📊 My stats`.
- В Season 5/6 `/ch` считает estimated reward только для top-10 bakeries: `bakery score / top-10 score * prize pool`, затем `member score / bakery score`.
- Season 6 использует score как reward metric, не raw cookies: score растет от cookies baked с daily scaler `+5%` за день сезона.
- Season 6 rewards могут меняться до конца сезона, потому что score share постоянно меняется.
- В image card для score-share сезонов rank tile показывает две доли: bakery score share и личную member score share, чтобы было понятно почему rank #2 не означает весь reward.
- Auto-bake, upgrades, boosts/rugs и random events могут менять будущий score; бот не запускает действия, а только читает live public stats и on-chain fees.
- Если у игрока есть Abstract Global Wallet profile/avatar, бот пытается подтянуть avatar через тот же публичный lookup-подход, что использует Abscope.
- В solo-сезонах `/ch` считает leaderboard reward по текущему rank игрока.
- В division-сезоне `/ch` определяет bakery division (`Standard` или `Open`) и считает leaderboard reward по актуальной payout table этой division.
- `Cook tx` считается по on-chain `Bake`-логам bakery-контракта для адреса и сезона.
- `Gas cost` считается как сумма реальной fee каждой найденной `Bake`-транзакции через `zks_getTransactionDetails`/receipts.
- Если точные fee временно недоступны, бот показывает `N/A`, а не подставляет приблизительную сумму.
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

По умолчанию `/ch` не использует фиксированную комиссию для `Gas cost`: бот суммирует реальные on-chain fee по каждой bake-транзакции.

Фиксированный fallback ниже нужен только если явно включить approximate mode:

```text
0.00000675 ETH
```

Чтобы временно вернуть старое приблизительное поведение при проблемах RPC, можно включить approximate fallback через `.env`:

```bash
ALLOW_APPROX_GAS_FALLBACK=true
BAKE_TX_FEE_ETH=0.00000675
```
