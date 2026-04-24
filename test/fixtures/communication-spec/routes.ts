interface CreateOrderRequest {
  customerId: string;
  quantity: number;
  priority?: "normal" | "urgent";
}

interface OrderResponse {
  orderId: string;
  accepted: boolean;
}

const app = {
  post(_path: string, _handler: unknown) {},
};

app.post("/orders", (request: CreateOrderRequest): OrderResponse => {
  return {
    orderId: request.customerId,
    accepted: request.quantity > 0,
  };
});
