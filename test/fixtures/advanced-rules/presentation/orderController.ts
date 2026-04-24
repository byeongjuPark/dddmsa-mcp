import { SqlOrderRepository } from "../infrastructure/sqlOrderRepository";

export class OrderController {
  constructor(private readonly repository: SqlOrderRepository) {}
}

