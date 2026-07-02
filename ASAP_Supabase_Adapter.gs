function fetchProductsWithLenderCode_(bustCache) {
  // Single query with PostgREST join — NOT a loop
  var rows = sbFetch_('lender_products', '*,lenders(lender_code,name,contact_ae,phone_email,states_notes,confidence,deals_history,sweet_spot)', 'status=eq.Active', bustCache);
  return rows.map(function(r) {
    var lender = r.lenders || {};
    return {
      ProductID:    r.product_code,
      LenderID:     lender.lender_code || '',
      Lender:       lender.name || '',
      Contact:      lender.contact_ae || '',
      Phone_Email:  lender.phone_email || '',
      States_Notes: r.states_override || lender.states_notes || '',
      Confidence:   lender.confidence || 'MED',
      DealsWithDK:  lender.deals_history || '',
      SweetSpot:    lender.sweet_spot || '',
      // Product type — replaces the old Y/N flag columns
      Product:      r.product,
      // Hard gate fields
      MinLoanNum:   r.min_loan,
      MaxLoanNum:   r.max_loan,
      MinFICONum:   r.min_fico_hard,
      MinLoan:      r.min_loan,
      MaxLoan:      r.max_loan,
      MinFICO_Hard: r.min_fico_hard,
      WhiteLabel:   r.white_label,
      AppraisalReq: r.appraisal_req,
      _uuid:        r.id,
      _lenderUUID:  r.lender_id,
    };
  });
}