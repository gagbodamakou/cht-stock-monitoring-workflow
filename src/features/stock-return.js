const inquirer = require('inquirer');
const { copyFileSync, writeFileSync } = require('fs');
const path = require('path');
const chalk = require('chalk');
const { Workbook } = require('exceljs');
const { getRowWithValueAtPosition, getTranslations, buildRowValues, getSheetGroupBeginEnd, getDefaultSurveyLabels,
  addCategoryItemsToChoice
} = require('../common');

function getChoicesFromMessage(messages, languages, choiceName, key = 'stock_return.forms.select_items.reason') {
  const choices = Object.keys(messages[languages[0]])
    .filter(m => m.startsWith(key))
    .map(m => m.replace(`${key}.`, ''));

  return choices.map((choice) => {
    return {
      list_name: choiceName,
      name: choice,
      ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: messages[language][`${key}.${choice}`] }), {})
    };
  });
}

// @param {Array} header - The header array
// @param {Array} languages - The languages array
// @param {Object} messages - The messages object
// @param {string} selectionFieldName - The selection field name
// @param {Array} items - The items array
// @returns {Array} - The item rows to add to worksheet
function getItemRows(header, languages, messages, selectionFieldName, items) {
  return items.map((item) => {
    return [
      buildRowValues(header, {
        type: 'begin group',
        name: `___${item.name}`,
        relevant: 'selected(${' + selectionFieldName + `}, '${item.name}')`,
        ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: item.label[language] }), {})
      }),
      buildRowValues(header, {
        type: 'select_multiple return_reason',
        name: `${item.name}_return_reason`,
        required: 'yes',
        ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: messages[language]['stock_return.forms.select_items.return_reason'] }), {})
      }),
      buildRowValues(header, {
        type: 'text',
        name: `${item.name}_reason_note`,
        required: 'yes',
        relevant: 'selected(${' + item.name + '_return_reason}, ' + `'other')`,
        ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: messages[language]['stock_return.forms.specify'] }), {})
      }),
      buildRowValues(header, {
        type: 'note',
        name: `${item.name}_before`,
        ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: messages[language]['stock_return.forms.qty_before'] + ': ${' + item.name + '_current}' }), {})
      }),
      buildRowValues(header, {
        type: 'decimal',
        name: `${item.name}_returned_qty`,
        required: 'yes',
        constraint: '. > 0 and . <= ${' + item.name + '_current}',
        default: 0,
        ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: messages[language]['stock_return.forms.qty_returned'] }), {})
      }),
      buildRowValues(header, {
        type: 'calculate',
        name: `${item.name}_after`,
        calculation: '${' + item.name + '_current} - if(${' + `${item.name}_returned_qty} != '',` + '${' + `${item.name}_returned_qty},0)`
      }),
      buildRowValues(header, {
        type: 'note',
        name: `${item.name}_after_note`,
        ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: messages[language]['stock_return.forms.qty_after'] + ': ${' + item.name + '_after}' }), {})
      }),
      buildRowValues(header, {
        type: 'end group',
      }),
    ];
  });
}

function addReturnedSummaries(workSheet, languages, items, categories = []) {
  const [, end] = getSheetGroupBeginEnd(workSheet, 'summary');
  const header = workSheet.getRow(1).values;
  header.shift();
  let rows = [];
  if (categories.length > 0) {
    for (const category of categories) {
      rows.push(
        buildRowValues(header, {
          type: 'note',
          name: `${category.name}_summary`,
          appearance: 'h1 blue',
          relevant: 'selected(${categories}, ' + `'${category.name}')`,
          ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: category.label[language] }), {})
        }),
        ...items.filter(it => it.category === category.name).map((item) => (buildRowValues(header, {
          type: 'note',
          name: `${item.name}_summary`,
          appearance: 'li',
          relevant: 'selected(${' + category.name + '_items_selected}, ' + `'${item.name}')`,
          ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: `${item.label[language]}: ` + '${' + `${item.name}_returned_qty}` }), {})
        }))),
      );
    }
  } else {
    rows = items.map((item) => ({
      type: 'note',
      name: `${item.name}_summary`,
      appearance: 'li',
      relevant: 'selected(${list_items_selected}, ' + `'${item.name}')`,
      ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: `${item.name[language]}: ` + '${' + `${item.name}_returned_qty}` }), {})
    }));
  }
  //Insert item
  workSheet.insertRows(
    end,
    rows,
    'i+'
  );
}

function addExportCalculation(workSheet, items) {
  const [, end] = getSheetGroupBeginEnd(workSheet, 'out');
  const header = workSheet.getRow(1).values;
  header.shift();
  const itemRows = [
    ...items.map((item) => buildRowValues(header, {
      type: 'calculate', // Row type
      name: `${item.name}_out`, // Row name
      calculation: 'if(${' + `${item.name}_returned_qty} != '',` + '${' + `${item.name}_returned_qty},0)`
    }))
  ];

  //Insert item
  workSheet.insertRows(
    end,
    itemRows,
    'i+'
  );
}

async function updateStockReturn(configs) {
  const processDir = process.cwd();
  const returnConfigs = configs.features.stock_return;
  const items = Object.values(configs.items);
  const categories = Object.values(configs.categories);
  const { languages } = configs;
  const messages = getTranslations();

  const returnFormPath = path.join(processDir, 'forms', 'app', `${returnConfigs.form_name}.xlsx`);
  copyFileSync(path.join(__dirname, '../../templates/stock_supply.xlsx'), returnFormPath);
  const workbook = new Workbook();
  await workbook.xlsx.readFile(returnFormPath);
  const surveyWorkSheet = workbook.getWorksheet('survey');
  const choiceWorkSheet = workbook.getWorksheet('choices');
  const settingWorkSheet = workbook.getWorksheet('settings');

  //SURVEY
  const [labelColumns, hintColumns] = getDefaultSurveyLabels(
    'stock_return',
    messages,
    configs.languages,
  );
  // Add languages and hints columns
  const [, firstRowData] = getRowWithValueAtPosition(surveyWorkSheet, 'type', 0);
  let lastColumnIndex = Object.keys(firstRowData).length;
  for (const labelColumn of labelColumns) {
    surveyWorkSheet.getColumn(lastColumnIndex + 1).values = labelColumn;
    lastColumnIndex++;
  }
  for (const hintColumn of hintColumns) {
    surveyWorkSheet.getColumn(lastColumnIndex + 1).values = hintColumn;
    lastColumnIndex++;
  }
  // Add choice filter column
  surveyWorkSheet.getColumn(lastColumnIndex + 1).values = ['choice_filter'];

  const header = surveyWorkSheet.getRow(1).values;
  header.shift();
  const [placeIdPosition,] = getRowWithValueAtPosition(surveyWorkSheet, 'place_id', 1);

  const rows = items.map((item) => {
    return buildRowValues(header, {
      type: 'calculate',
      name: `${item.name}_current`,
      default: 0,
      calculation: `instance('contact-summary')/context/stock_monitoring_${item.name}_qty`
    });
  });
  if (configs.useItemCategory) {
    rows.push(
      buildRowValues(header, {
        type: 'begin group',
        name: `select_categories`,
        appearance: 'field-list',
        ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: messages[language]['stock_return.forms.select_category_label'] }), {})
      }),
      buildRowValues(header, {
        type: 'select_multiple categories',
        name: 'categories',
        required: 'yes',
        ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: messages[language]['stock_return.forms.select_category'] }), {})
      }),
      buildRowValues(header, {
        type: 'end group',
      }),
      ...categories.map((category) => {
        return [
          buildRowValues(header, {
            type: 'begin group',
            name: category.name,
            appearance: 'field-list',
            relevant: 'selected(${categories}, ' + `'${category.name}')`,
            ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: category.label[language] }), {})
          }),
          buildRowValues(header, {
            type: 'select_multiple items',
            required: 'yes',
            name: `${category.name}_items_selected`,
            choice_filter: `category_filter = '${category.name}'`,
            ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: messages[language]['stock_return.forms.select_items'] }), {})
          }),
          ...getItemRows(
            header,
            languages,
            messages,
            `${category.name}_items_selected`,
            items.filter((item) => item.category === category.name),
          ).reduce((prev, itemRows) => ([...prev, ...itemRows]), []),
          buildRowValues(header, {
            type: 'end group',
          }),
        ];
      }).reduce((prev, categoryRows) => ([...prev, ...categoryRows]), []),
    );
  } else {
    rows.push(
      buildRowValues(header, {
        type: 'begin group',
        name: 'items_selection',
        ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: messages[language]['stock_return.forms.items_selection'] }), {})
      }),
      buildRowValues(header, {
        type: 'select_multiple items',
        required: 'yes',
        name: 'list_items_selected',
        ...languages.reduce((prev, language) => ({ ...prev, [`label::${language}`]: messages[language]['stock_return.forms.select_items'] }), {})
      }),
      ...getItemRows(
        header,
        languages,
        messages,
        'list_items_selected',
        items
      ),
      buildRowValues(header, {
        type: 'end group',
      }),
    );
  }
  surveyWorkSheet.insertRows(
    placeIdPosition + 1,
    rows,
    'i+'
  );
  addReturnedSummaries(surveyWorkSheet, languages, items, configs.useItemCategory ? categories : []);
  addExportCalculation(surveyWorkSheet, items);

  //CHOICES
  addCategoryItemsToChoice(categories, items, choiceWorkSheet, languages);
  const choiceHeader = choiceWorkSheet.getRow(1).values;
  choiceHeader.shift();
  const returnReasonChoiceRows = getChoicesFromMessage(messages, languages, 'return_reason').map((choice) => buildRowValues(choiceHeader, choice));
  choiceWorkSheet.addRows(returnReasonChoiceRows, 'i+');

  // SETTINGS
  settingWorkSheet.getRow(2).getCell(1).value = returnConfigs.title[configs.defaultLanguage];
  settingWorkSheet.getRow(2).getCell(2).value = returnConfigs.form_name;

  await workbook.xlsx.writeFile(returnFormPath);

  // Add stock count form properties
  const expression = `user.parent.contact_type === '${configs.levels[1].place_type}' && contact.contact_type === '${configs.levels[1].place_type}'`;
  const formProperties = {
    'icon': 'icon-healthcare-medicine',
    'context': {
      'person': false,
      'place': true,
      expression,
    },
    title: languages.map((lang) => {
      return {
        locale: lang,
        content: returnConfigs.title[lang]
      };
    }),
  };
  const propertyPath = path.join(processDir, 'forms', 'app', `${returnConfigs.form_name}.properties.json`);
  writeFileSync(propertyPath, JSON.stringify(formProperties, null, 4));
  console.log(chalk.green(`INFO ${returnConfigs.form_name} updated successfully`));
}

async function getStockReturnConfigs({
  languages,
}) {
  return await inquirer.prompt([
    {
      type: 'input',
      name: 'form_name',
      message: 'Enter stock return form ID',
      default: 'stock_return'
    },
    ...languages.map((language) => ({
      type: 'input',
      name: `title.${language}`,
      message: `Enter stock return form title in ${language}`,
      default: 'Stock Return'
    })),
    {
      type: 'input',
      name: 'confirmation.form_name',
      message: 'Enter stock returned confirmation form ID',
      default: 'stock_returned'
    },
    ...languages.map((language) => ({
      type: 'input',
      name: `confirmation.title.${language}`,
      message: `Enter stock returned confirmation form title in ${language}`,
      default: 'Stock Returned'
    })),
  ]);
}

module.exports = {
  updateStockReturn,
  getStockReturnConfigs,
};
