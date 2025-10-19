/**
 * MessageBus Unit Tests
 */

const MessageBus = require('../../.claude/core/message-bus');

describe('MessageBus', () => {
  let messageBus;

  beforeEach(() => {
    messageBus = new MessageBus();
  });

  afterEach(() => {
    messageBus.clear();
  });

  describe('Publish/Subscribe', () => {
    test('should subscribe and receive messages', (done) => {
      const topic = 'test-topic';
      const testMessage = { data: 'test data' };

      messageBus.subscribe(topic, 'subscriber1', (message) => {
        expect(message.data).toBe('test data');
        expect(message._metadata).toBeDefined();
        expect(message._metadata.topic).toBe(topic);
        expect(message._metadata.publisherId).toBe('publisher1');
        done();
      });

      messageBus.publish(topic, testMessage, 'publisher1');
    });

    test('should support multiple subscribers', () => {
      const topic = 'multi-sub';
      let count = 0;

      messageBus.subscribe(topic, 'sub1', () => count++);
      messageBus.subscribe(topic, 'sub2', () => count++);
      messageBus.subscribe(topic, 'sub3', () => count++);

      messageBus.publish(topic, { test: true }, 'pub1');

      expect(count).toBe(3);
    });

    test('should unsubscribe correctly', () => {
      const topic = 'unsub-test';
      let count = 0;

      const unsubscribe = messageBus.subscribe(topic, 'sub1', () => count++);

      messageBus.publish(topic, {}, 'pub1');
      expect(count).toBe(1);

      unsubscribe();

      messageBus.publish(topic, {}, 'pub1');
      expect(count).toBe(1); // Count should not increase
    });

    test('should track subscriptions per topic', () => {
      messageBus.subscribe('topic1', 'agent1', () => {});
      messageBus.subscribe('topic1', 'agent2', () => {});
      messageBus.subscribe('topic2', 'agent3', () => {});

      expect(messageBus.getSubscribers('topic1')).toHaveLength(2);
      expect(messageBus.getSubscribers('topic2')).toHaveLength(1);
      expect(messageBus.getSubscribers('topic3')).toHaveLength(0);
    });
  });

  describe('Request/Response', () => {
    test('should handle request-response pattern', async () => {
      const topic = 'request-topic';

      // Set up responder
      messageBus.subscribe(topic, 'responder', (message) => {
        messageBus.reply(message, { answer: 42 }, 'responder');
      });

      // Make request
      const responses = await messageBus.request(
        topic,
        { question: 'what is the answer?' },
        'requester',
        { timeout: 1000, responseCount: 1 }
      );

      expect(responses).toHaveLength(1);
      expect(responses[0].answer).toBe(42);
    });

    test('should timeout if no response received', async () => {
      await expect(
        messageBus.request('no-response-topic', {}, 'requester', { timeout: 100 })
      ).rejects.toThrow('Request timeout');
    });

    test('should collect multiple responses', async () => {
      const topic = 'multi-response';

      // Set up multiple responders
      messageBus.subscribe(topic, 'resp1', (message) => {
        messageBus.reply(message, { id: 1 }, 'resp1');
      });

      messageBus.subscribe(topic, 'resp2', (message) => {
        messageBus.reply(message, { id: 2 }, 'resp2');
      });

      messageBus.subscribe(topic, 'resp3', (message) => {
        messageBus.reply(message, { id: 3 }, 'resp3');
      });

      const responses = await messageBus.request(
        topic,
        {},
        'requester',
        { timeout: 1000, responseCount: 3 }
      );

      expect(responses).toHaveLength(3);
      expect(responses.map(r => r.id).sort()).toEqual([1, 2, 3]);
    });
  });

  describe('Message History', () => {
    test('should store message history', () => {
      messageBus.publish('topic1', { msg: 1 }, 'pub1');
      messageBus.publish('topic2', { msg: 2 }, 'pub1');
      messageBus.publish('topic1', { msg: 3 }, 'pub2');

      const history = messageBus.getHistory();
      expect(history).toHaveLength(3);
    });

    test('should filter history by topic', () => {
      messageBus.publish('topic1', { msg: 1 }, 'pub1');
      messageBus.publish('topic2', { msg: 2 }, 'pub1');
      messageBus.publish('topic1', { msg: 3 }, 'pub1');

      const topic1History = messageBus.getHistory('topic1');
      expect(topic1History).toHaveLength(2);
      expect(topic1History.every(m => m._metadata.topic === 'topic1')).toBe(true);
    });

    test('should limit history size', () => {
      for (let i = 0; i < 1100; i++) {
        messageBus.publish('test', { i }, 'pub');
      }

      const history = messageBus.getHistory(null, 1100);
      expect(history.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('Active Topics', () => {
    test('should track active topics', () => {
      messageBus.subscribe('topic1', 'agent1', () => {});
      messageBus.subscribe('topic2', 'agent2', () => {});
      messageBus.subscribe('topic3', 'agent3', () => {});

      const topics = messageBus.getActiveTopics();
      expect(topics).toHaveLength(3);
      expect(topics).toContain('topic1');
      expect(topics).toContain('topic2');
      expect(topics).toContain('topic3');
    });
  });

  describe('Clear', () => {
    test('should clear all subscriptions and history', () => {
      messageBus.subscribe('topic1', 'agent1', () => {});
      messageBus.publish('topic1', {}, 'pub1');

      messageBus.clear();

      expect(messageBus.getActiveTopics()).toHaveLength(0);
      expect(messageBus.getHistory()).toHaveLength(0);
    });
  });
});
