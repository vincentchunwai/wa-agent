export enum PiiType {
  Email = 'email',
  Phone = 'phone',
  CreditCard = 'credit_card',
  SSN = 'ssn',
  IpAddress = 'ip_address',
}

export interface PiiMatch {
  type: PiiType;
  value: string;
  start: number;
  end: number;
}
