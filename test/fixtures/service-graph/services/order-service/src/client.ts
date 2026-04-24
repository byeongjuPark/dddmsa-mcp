import pg from "pg";

export async function createOrder(publisher: { publish(topic: string): void }, client: { GetInvoice(): void }) {
  await fetch("http://billing-service/api/invoices");
  publisher.publish("order.created");
  client.GetInvoice();
  return pg;
}
