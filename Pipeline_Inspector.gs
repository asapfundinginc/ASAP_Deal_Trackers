function inspectTracker() {
  var ssId = '1M7tbNvwJxmksCgzRO6dRI-Yu4sonKpg0It4NHcB9F50';
  var ss = SpreadsheetApp.openById(ssId);
  var loanTracker = ss.getSheetByName('Loan Tracker');
  var loanData = ss.getSheetByName('Loan Data');
  var deadDeals = ss.getSheetByName('Dead Deals');
  
  Logger.log('=== LOAN TRACKER (first 2 data rows) ===');
  var ltRange = loanTracker.getRange(2, 1, 2, 17);
  Logger.log('Values:\n' + JSON.stringify(ltRange.getValues(), null, 2));
  Logger.log('Formulas:\n' + JSON.stringify(ltRange.getFormulas(), null, 2));
  
  Logger.log('\n=== LOAN DATA (first 2 data rows) ===');
  var ldRange = loanData.getRange(2, 1, 2, 17);
  Logger.log('Values:\n' + JSON.stringify(ldRange.getValues(), null, 2));
  Logger.log('Formulas:\n' + JSON.stringify(ldRange.getFormulas(), null, 2));
  
  Logger.log('\n=== DEAD DEALS (first 2 data rows) ===');
  var ddRange = deadDeals.getRange(2, 1, 2, 17);
  Logger.log('Values:\n' + JSON.stringify(ddRange.getValues(), null, 2));
  Logger.log('Formulas:\n' + JSON.stringify(ddRange.getFormulas(), null, 2));
  
  var currentStatusCol = loanData.getRange('C2').getDataValidation();
  if (currentStatusCol) {
    Logger.log('\n=== CURRENT STATUS DROPDOWN (Loan Data C column) ===');
    Logger.log('Criteria Type: ' + currentStatusCol.getCriteriaType());
    Logger.log('Criteria Values: ' + JSON.stringify(currentStatusCol.getCriteriaValues(), null, 2));
  }
  
  Logger.log('\n=== Done ===');
}