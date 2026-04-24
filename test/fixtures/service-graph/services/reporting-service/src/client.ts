export async function loadReports() {
  await fetch("http://order-service/api/orders");
  await fetch("http://billing-service/api/invoices");
  await fetch("http://customer-service/api/customers");
  return fetch("http://inventory-service/api/items");
}
