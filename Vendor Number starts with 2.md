* Vendor Number starts with 2\*\*\*\*
* Project Number In the project details
* supplier is a vendor (should take the Sub account of the Vendors)
* remove unearned revenue column in **Journal-entries/\[id]**
* make notes in the Add payment modal be the description of the entry in **Journal-entries/\[id]**
* in the advanced-payments/id, we need to show the Journal entries connected with this payment
* the order amount in the new sales order should match the total amount 
* in the **Journal-entries/\[id]**, we need the entries that contains Debit to be arranged above each other, then the credit above each other for a better UI.
* when not adding taxes, a problem happens in the entry where the system sets a taxes automatically. we need if there are no taxes in the Sales Order only, the taxes record must be a 0 and not displayed.
* ***in the Purchase order, when purchasing a product, make the existing JE. but when buying a service, do not make the Materials Inventory and replace it with (PUC account) which will be extracted from the service data when the service was created.***
* the charts of accounts **MUST** arranged according to the Account number
* any dealing with a sales order or PO in the system (reports )will use the order total amount (Including Vat and taxes)

