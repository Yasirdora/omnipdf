/**
 * CrossIndustryInvoice XML serializer — Factur-X 1.0 / ZUGFeRD 2.x,
 * EN 16931 profile, UN/CEFACT D16B SCRDM.
 *
 * Element order inside each aggregate follows the D16B XSD sequences
 * (validators are sequence-strict); totals come from computeTotals() so
 * the XML and the rendered PDF can never disagree about money.
 */
import type { Invoice, InvoiceLine, InvoiceTotals, Party, VatBreakdown } from './model.js';

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** ISO date → CII format 102 (YYYYMMDD). */
function ciiDate(iso: string): string {
  return iso.split('-').join('');
}

function amount(v: number): string {
  return v.toFixed(2);
}

function party(p: Party, tag: 'SellerTradeParty' | 'BuyerTradeParty'): string {
  const address =
    p.zip || p.street || p.city
      ? `<ram:PostalTradeAddress>` +
        `${p.zip ? `<ram:PostcodeCode>${xmlEscape(p.zip)}</ram:PostcodeCode>` : ''}` +
        `${p.street ? `<ram:LineOne>${xmlEscape(p.street)}</ram:LineOne>` : ''}` +
        `${p.city ? `<ram:CityName>${xmlEscape(p.city)}</ram:CityName>` : ''}` +
        `<ram:CountryID>${xmlEscape(p.country)}</ram:CountryID>` +
        `</ram:PostalTradeAddress>`
      : `<ram:PostalTradeAddress><ram:CountryID>${xmlEscape(p.country)}</ram:CountryID></ram:PostalTradeAddress>`;
  const email = p.email
    ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${xmlEscape(p.email)}</ram:URIID></ram:URIUniversalCommunication>`
    : '';
  const vat = p.vatId
    ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${xmlEscape(p.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>`
    : '';
  return `<ram:${tag}><ram:Name>${xmlEscape(p.name)}</ram:Name>${address}${email}${vat}</ram:${tag}>`;
}

function lineItem(line: InvoiceLine, index: number, lineAmount: number): string {
  return (
    `<ram:IncludedSupplyChainTradeLineItem>` +
    `<ram:AssociatedDocumentLineDocument><ram:LineID>${index + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>` +
    `<ram:SpecifiedTradeProduct><ram:Name>${xmlEscape(line.description)}</ram:Name></ram:SpecifiedTradeProduct>` +
    `<ram:SpecifiedLineTradeAgreement>` +
    `<ram:NetPriceProductTradePrice><ram:ChargeAmount>${amount(line.unitPrice)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>` +
    `</ram:SpecifiedLineTradeAgreement>` +
    `<ram:SpecifiedLineTradeDelivery>` +
    `<ram:BilledQuantity unitCode="${line.unitCode ?? 'C62'}">${line.quantity}</ram:BilledQuantity>` +
    `</ram:SpecifiedLineTradeDelivery>` +
    `<ram:SpecifiedLineTradeSettlement>` +
    `<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode>` +
    `<ram:RateApplicablePercent>${line.vatRate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>` +
    `<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(lineAmount)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>` +
    `</ram:SpecifiedLineTradeSettlement>` +
    `</ram:IncludedSupplyChainTradeLineItem>`
  );
}

function vatRow(v: VatBreakdown): string {
  return (
    `<ram:ApplicableTradeTax>` +
    `<ram:CalculatedAmount>${amount(v.tax)}</ram:CalculatedAmount>` +
    `<ram:TypeCode>VAT</ram:TypeCode>` +
    `<ram:BasisAmount>${amount(v.basis)}</ram:BasisAmount>` +
    `<ram:CategoryCode>S</ram:CategoryCode>` +
    `<ram:RateApplicablePercent>${v.rate}</ram:RateApplicablePercent>` +
    `</ram:ApplicableTradeTax>`
  );
}

/** Serialize an invoice to the Factur-X CII XML payload. */
export function invoiceToCiiXml(inv: Invoice, totals: InvoiceTotals): string {
  const note = inv.notes
    ? `<ram:IncludedNote><ram:Content>${xmlEscape(inv.notes)}</ram:Content></ram:IncludedNote>`
    : '';
  const buyerRef = inv.buyerReference
    ? `<ram:BuyerReference>${xmlEscape(inv.buyerReference)}</ram:BuyerReference>`
    : '';
  const paymentMeans = inv.iban
    ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode>` +
      `<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${xmlEscape(inv.iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>` +
      `</ram:SpecifiedTradeSettlementPaymentMeans>`
    : '';
  const paymentTerms =
    inv.dueDate || inv.paymentTerms
      ? `<ram:SpecifiedTradePaymentTerms>` +
        `${inv.paymentTerms ? `<ram:Description>${xmlEscape(inv.paymentTerms)}</ram:Description>` : ''}` +
        `${inv.dueDate ? `<ram:DueDateDateTime><udt:DateTimeString format="102">${ciiDate(inv.dueDate)}</udt:DateTimeString></ram:DueDateDateTime>` : ''}` +
        `</ram:SpecifiedTradePaymentTerms>`
      : '';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rsm:CrossIndustryInvoice ` +
    `xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" ` +
    `xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" ` +
    `xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" ` +
    `xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">\n` +
    `<rsm:ExchangedDocumentContext>` +
    `<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:factur-x.eu:1p0:en16931</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>` +
    `</rsm:ExchangedDocumentContext>\n` +
    `<rsm:ExchangedDocument>` +
    `<ram:ID>${xmlEscape(inv.number)}</ram:ID>` +
    `<ram:TypeCode>380</ram:TypeCode>` +
    `<ram:IssueDateTime><udt:DateTimeString format="102">${ciiDate(inv.issueDate)}</udt:DateTimeString></ram:IssueDateTime>` +
    note +
    `</rsm:ExchangedDocument>\n` +
    `<rsm:SupplyChainTradeTransaction>\n` +
    inv.lines.map((l, i) => lineItem(l, i, totals.lineAmounts[i]!)).join('\n') +
    `\n<ram:ApplicableHeaderTradeAgreement>` +
    buyerRef +
    party(inv.seller, 'SellerTradeParty') +
    party(inv.buyer, 'BuyerTradeParty') +
    `</ram:ApplicableHeaderTradeAgreement>\n` +
    `<ram:ApplicableHeaderTradeDelivery/>\n` +
    `<ram:ApplicableHeaderTradeSettlement>` +
    `<ram:InvoiceCurrencyCode>${xmlEscape(inv.currency)}</ram:InvoiceCurrencyCode>` +
    paymentMeans +
    totals.vat.map(vatRow).join('') +
    paymentTerms +
    `<ram:SpecifiedTradeSettlementHeaderMonetarySummation>` +
    `<ram:LineTotalAmount>${amount(totals.net)}</ram:LineTotalAmount>` +
    `<ram:TaxBasisTotalAmount>${amount(totals.net)}</ram:TaxBasisTotalAmount>` +
    `<ram:TaxTotalAmount currencyID="${xmlEscape(inv.currency)}">${amount(totals.tax)}</ram:TaxTotalAmount>` +
    `<ram:GrandTotalAmount>${amount(totals.gross)}</ram:GrandTotalAmount>` +
    `<ram:DuePayableAmount>${amount(totals.gross)}</ram:DuePayableAmount>` +
    `</ram:SpecifiedTradeSettlementHeaderMonetarySummation>` +
    `</ram:ApplicableHeaderTradeSettlement>\n` +
    `</rsm:SupplyChainTradeTransaction>\n` +
    `</rsm:CrossIndustryInvoice>`
  );
}
