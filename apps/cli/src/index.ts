import { defineCommand, runMain } from "citty";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { balancesCommand } from "./commands/balances.js";
import { sellCommand } from "./commands/sell.js";
import { buyCommand } from "./commands/buy.js";
import { sendCommand } from "./commands/send.js";

const main = defineCommand({
  meta: {
    name: "horizon",
    version: "0.0.1",
    description: "Horizon Market CLI — init / list / balances / sell / buy / send",
  },
  subCommands: {
    init: initCommand,
    list: listCommand,
    balances: balancesCommand,
    sell: sellCommand,
    buy: buyCommand,
    send: sendCommand,
  },
});

void runMain(main);
