import { SqlOrderRepository } from "../adapters/sqlOrderRepository";

export class Order {
  constructor(private readonly repository: SqlOrderRepository) {}
}

