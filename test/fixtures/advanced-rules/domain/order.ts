import { Entity } from "typeorm";
import { Customer } from "../contexts/customer/domain/entities/customer";

@Entity()
export class Order {
  constructor(private readonly customer: Customer) {}
}

