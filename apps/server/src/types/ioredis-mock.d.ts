// ioredis-mock ships no type definitions. It mimics the real client's API,
// so typing its default export as the ioredis constructor is accurate for
// everything the specs use (eval, flushall, zadd, ...).
declare module 'ioredis-mock' {
  import Redis from 'ioredis';

  const RedisMock: typeof Redis;
  export default RedisMock;
}
