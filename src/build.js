const chalk = require('chalk');
const { updateForm } = require('./features/form-update');
const { updateStockCount } = require('./features/stock-count');
const { updateStockReturn } = require('./features/stock-return');
const { updateStockSupply } = require('./features/stock-supply');
const { updateTranslations } = require('./utils');

module.exports = async function (configs) {

  // Update app translations
  updateTranslations(configs);

  for (const feature of Object.keys(configs.features)) {
    switch (feature) {
      case 'stock_count':
      // Create stock count form xlsx
        await updateStockCount(configs);
        break;
      case 'stock_supply':
        // Create stock supply form xlsx
        await updateStockSupply(configs);
        break;
      case 'stock_return':
        // Create stock supply form xlsx
        await updateStockReturn(configs);
        break;
      default:
        break;
    }
  }

  await updateForm(configs);
  console.log(chalk.green(`INFO All actions completed`));
};
