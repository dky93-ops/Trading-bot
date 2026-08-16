import { Candle } from '../src/backend/types';

export interface Fixture {
  name: string;
  setup: () => void;
  evaluate: () => Promise<any>;
}
// For replay tests
