import { SqlOrderRepository } from "../infrastructure/sqlOrderRepository";

export class Order {
  constructor(private readonly repository: SqlOrderRepository) {}
}

