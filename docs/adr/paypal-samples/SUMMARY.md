# PayPal sandbox smoke run 20261022170335

Order 7CV2269518094610C · capture 41995584GM234064G · refund 2EU12368F9867740A

| Step | HTTP | Result |
| --- | --- | --- |
| create order | 200 | id 7CV2269518094610C, status PAYER_ACTION_REQUIRED |
| create again, same request id | 200 | id 7CV2269518094610C (same order) |
| capture before approval | 422 | ORDER_NOT_APPROVED |
| order after approval | 200 | status APPROVED |
| capture | 201 | order COMPLETED, capture 41995584GM234064G COMPLETED |
| capture retry, same request id | 200 | capture 41995584GM234064G |
| capture again, new request id | 422 | ORDER_ALREADY_CAPTURED |
| partial refund | 201 | refund 2EU12368F9867740A COMPLETED |
| refund again, same request id | 200 | refund 2EU12368F9867740A (same refund) |
| over-refund | 422 | REFUND_AMOUNT_EXCEEDED |

Raw responses are the numbered JSON files in this folder.
