const { DateTime } = require('luxon');
const { TRANSLATION_PREFIX } = require('./utils');

const getDynamicReportedDate = report => {
  const specifiedDate = Utils.getField(report, 's_reported.s_reported_date') || Utils.getField(report, 'supervision_date');
  return (specifiedDate && DateTime.fromISO(specifiedDate)) ||
    DateTime.fromMillis(parseInt((report && report.reported_date) || 0));
};

function getStockTask(configs) {
  const tasks = [];
  const items = Object.values(configs.items);
  if (configs.features.stock_supply && configs.features.stock_supply.confirm_supply) {
    tasks.push(
      {
        name: 'task.stock-monitoring.reception-confirmation',
        title: `${TRANSLATION_PREFIX}stock_supply.tasks.reception-confirmation`,
        icon: 'icon-healthcare-medicine',
        appliesTo: 'reports',
        appliesToType: [configs.features.stock_supply.form_name],
        appliesIf: (contact, report) => {
          const confirmationReport = contact.reports.find((rp) => rp.form === configs.features.stock_supply.confirm_supply.form_name && Utils.getField(rp, 'inputs.source_id') === report._id);
          // eslint-disable-next-line no-undef
          return !confirmationReport && user.role === configs.levels['1'].role;
        },
        events: [
          {
            start: 0,
            end: 30,
            dueDate: function (event, contact, report) {
              return DateTime.fromISO(getDynamicReportedDate(report)).toJSDate();
            },
          },
        ],
        actions: [
          {
            form: configs.features.stock_supply.confirm_supply.form_name,
            modifyContent: function (content, contact, report) {
              for (const item of items) {
                content[`${item.name}_received`] = Utils.getField(report, `out.${item.name}_supply`);
              }
            }
          }
        ]
      }
    );
  }
  return tasks;
}

module.exports = getStockTask;
