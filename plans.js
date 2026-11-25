// ============================================================
//  EDIT THIS FILE to set your own plans, limits and prices.
//  Prices are placeholders: replace them with what you want to charge.
//  Everything on the pricing page and in billing is generated from here.
// ============================================================
module.exports = {
  currency: 'ETB',
  trialDays: 14,
  // Paying for 12 months at once costs this many months of the monthly price (2 months free here). Set to 12 for no discount.
  annualMonthsPaid: 10,
  // Shown to schools when they request an upgrade. You can also set the PAYMENT_INSTRUCTIONS environment variable.
  paymentInstructions: 'Pay by bank transfer or mobile money, then enter the payment reference below. We activate your plan as soon as the payment is confirmed. Contact us for the account details.',
  plans: {
    trial: { name: 'Free trial', price: 0, maxTeachers: 2, maxExams: 3, maxAttemptsPerMonth: 100, ai: true },
    starter: { name: 'Starter', price: 1500, maxTeachers: 5, maxExams: 30, maxAttemptsPerMonth: 500, ai: true },
    school: { name: 'School', price: 3500, maxTeachers: 20, maxExams: 200, maxAttemptsPerMonth: 3000, ai: true },
    campus: { name: 'Campus', price: 7500, maxTeachers: 100, maxExams: 1000, maxAttemptsPerMonth: 15000, ai: true },
  },
};
