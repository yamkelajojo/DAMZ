// Jest setup for @damz/db
import 'jest-expo';

// Mock @nozbe/watermelondb
jest.mock('@nozbe/watermelondb', () => ({
  Database: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockReturnValue({
      query: jest.fn().mockReturnValue({
        fetch: jest.fn().mockResolvedValue([]),
        where: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        notEq: jest.fn().mockReturnThis(),
      }),
      create: jest.fn().mockResolvedValue({}),
    }),
    write: jest.fn((fn) => fn()),
    adapter: {
      close: jest.fn(),
      unsafeSqlQuery: jest.fn().mockResolvedValue(undefined),
    },
  })),
  Model: class Model {
    static table = '';
    static associations = {};
    @field('test') test!: string;
  },
  field: () => () => {},
  text: () => () => {},
  date: () => () => {},
  readonly: () => () => {},
  children: () => () => {},
  Associations: {},
}));

// Mock @nozbe/watermelondb/adapters/sqlite
jest.mock('@nozbe/watermelondb/adapters/sqlite', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    close: jest.fn(),
    unsafeSqlQuery: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  getItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock expo-crypto
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array(32)),
}));

console.log('DB Jest setup complete');