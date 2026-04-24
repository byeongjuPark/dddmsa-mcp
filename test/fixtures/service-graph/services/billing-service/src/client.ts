export async function loadOrder() {
  return fetch("http://order-service/api/orders/1");
}
