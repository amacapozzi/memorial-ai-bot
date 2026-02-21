export interface MeliSearchResult {
  id: string;
  title: string;
  price: number;
  currency_id: string;
  seller: {
    nickname: string;
  };
  permalink: string;
}

export interface MeliSearchResponse {
  results: MeliSearchResult[];
  paging: {
    total: number;
    offset: number;
    limit: number;
  };
}

export interface MeliOrderItem {
  item: {
    id: string;
    title: string;
  };
  quantity: number;
  unit_price: number;
}

export interface MeliOrder {
  id: number;
  status: string;
  date_created: string;
  order_items: MeliOrderItem[];
  shipping: {
    id: number | null;
  };
  total_amount: number;
  currency_id: string;
}

export interface MeliOrdersResponse {
  results: MeliOrder[];
  paging: {
    total: number;
    offset: number;
    limit: number;
  };
}

export interface MeliShipment {
  id: number;
  status: string;
  substatus: string | null;
  tracking_number: string | null;
  tracking_method: {
    name: string;
  } | null;
  status_history: {
    date_shipped: string | null;
    date_delivered: string | null;
  } | null;
}
