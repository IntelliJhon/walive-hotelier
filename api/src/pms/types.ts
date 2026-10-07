// Types for The Hotelier "Live Chat Interfacing" API v1.1, as observed on the test server.

export interface PmsBaseResponse {
  statuscode: number; // 0 = success, 1 = failure
  status: number; // 0 = success, 2 = error
  messagetype: number; // 0 = toast, 1 = dialog
  message: string;
}

export interface MisItem {
  code: string;
  name: string;
}

export interface PmsHotel {
  order: string;
  hotelId: string;
  hotelName: string;
  hotelType: string;
  bookableRooms: number;
  maxRoomNights: number;
  maxPax: number;
  maxAdult: number;
  maxChildren: number;
  maxInfant: number;
  maxBookingDays: number;
  totalRooms: number;
}

export interface PmsRoomType {
  order: number;
  roomTypeId: string;
  roomTypeName: string;
  maximumPax: number;
  maxAdult: number;
  maxChildren: number;
  maxInfant: number;
  twinBed: number;
  disabledAccess: number;
  totalRooms: number;
}

/** Price components shared by getrate, calcgst and softbook. */
export interface RateComponents {
  singleTariff: number;
  singlePlan: number;
  doubleTariff: number;
  doublePlan: number;
  extraAdultTariff: number;
  extraAdultPlan: number;
  extraChild1Tariff: number;
  extraChild1Plan: number;
  extraChild2Tariff: number;
  extraChild2Plan: number;
  rateType: string;
  rateCode: string;
}

export interface RateBand {
  fromDate: string;
  toDate: string;
  roomRate: RateComponents;
}

export interface InventoryBand {
  fromDate: string;
  toDate: string;
  roomCount: number;
}

/** Number of each charge in one roomTypes[] entry. */
export interface Occupancy {
  single: number;
  double: number;
  extraAdult: number;
  extraChild1: number;
  extraChild2: number;
  extraInfant: number;
}

export interface CalcGstRateIn extends RateComponents {
  date: string;
}

export interface CalcGstRoomTypeIn extends Occupancy {
  roomTypeId: string;
  rates: CalcGstRateIn[];
}

/**
 * One night as returned by calcgst. In v1.1 this exact object (plus mealPlan)
 * must be sent back in softbook rates[] so the booking carries GST.
 */
export interface TaxedRateLine extends CalcGstRateIn {
  value: number;
  tax: number;
  amount: number;
  [taxField: string]: string | number; // *Tax, *Taxcode, *Taxper
}

export interface SoftBookRoomType extends Occupancy {
  roomTypeId: string;
  twin: number;
  rates: (TaxedRateLine & { mealPlan: string })[];
}

export interface SoftBookHotel {
  hotelId: string;
  checkinDate: string;
  checkinTime: string;
  checkoutDate: string;
  checkoutTime: string;
  totalPax: number;
  totalAmount: string;
  roomTypes: SoftBookRoomType[];
}

export interface SoftBookGuest {
  title: string;
  firstName: string;
  lastName: string;
  address1: string;
  address2: string;
  country: string;
  countryIso: string;
  pin: string;
  emailId: string;
  phoneNumber: string;
  instructions: string;
  pickUp: { mode: string; arrival: string; details: string };
  hotels: SoftBookHotel[]; // nested inside guestDetails, as the PMS expects
}

export interface ConfirmTransaction {
  responseCode: string;
  transactionId: string;
  processingFeeAmount: number;
  transactionAmount: number;
  gst: number;
  totalAmount: number;
  transactionDate: string; // YYYY-MM-DDTHH:MM:SS
  interchangeValue: string;
  tdr: string;
  paymentMode: string;
  subMerchantId: string;
  referenceNo: string;
  id: string;
  rs: string;
  tps: string;
  mandatoryFields: string[];
  optionalFields: string;
  rsv: string;
  forexRate: string;
  forexAmount: string;
  currencyCode: string;
  merchantId: string;
  merchantOrderNo: string;
  failureReason: string;
}
