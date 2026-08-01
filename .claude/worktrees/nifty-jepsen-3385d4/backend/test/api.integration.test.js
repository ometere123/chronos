const request = require('supertest');
const { expect } = require('chai');
const app = require('../src/server');
const { vaultService } = require('../src/services/vaultService');
const { bridgeService } = require('../src/services/bridgeService');
const logger = require('../src/config/logger');

describe('API Integration Tests', () => {
  const testVaultId = '0x' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const testUserAddress = '0x' + '1'.repeat(40);
  const testJWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIweDEiLCJpYXQiOjE2MTYyMzkyMjJ9.test';

  describe('Health Check', () => {
    it('GET /health should return server status', (done) => {
      request(app)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body).to.have.property('status', 'ok');
          expect(res.body).to.have.property('timestamp');
          expect(res.body).to.have.property('services');
          done();
        });
    });

    it('GET /health should show service status', (done) => {
      request(app)
        .get('/health')
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.services).to.have.property('eventListener');
          expect(res.body.services).to.have.property('bridgeTracker');
          done();
        });
    });
  });

  describe('Vault Routes - POST /api/vaults/create', () => {
    it('should create vault with valid parameters', (done) => {
      const vaultData = {
        amount: '1000',
        customDuration: 604800000, // 7 days
        sourceChain: 84532,
        destinationChain: 26,
        bridgeProtocol: 'CCTP',
        tokenAddress: '0x036CbD53842c5426634C78482c0467f5C4738dF1',
        vaultType: 'FIXED'
      };

      request(app)
        .post('/api/vaults/create')
        .set('Authorization', `Bearer ${testJWT}`)
        .send(vaultData)
        .expect('Content-Type', /json/)
        .expect(201)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body).to.have.property('vaultId');
          expect(res.body).to.have.property('status', 'PENDING_BRIDGE');
          expect(res.body).to.have.property('unlockAt');
          expect(res.body).to.have.property('bridgeStatus');
          done();
        });
    });

    it('should reject invalid amount (zero)', (done) => {
      const vaultData = {
        amount: '0',
        customDuration: 604800000,
        sourceChain: 84532,
        destinationChain: 26,
        bridgeProtocol: 'CCTP',
        tokenAddress: '0x036CbD53842c5426634C78482c0467f5C4738dF1',
        vaultType: 'FIXED'
      };

      request(app)
        .post('/api/vaults/create')
        .set('Authorization', `Bearer ${testJWT}`)
        .send(vaultData)
        .expect(400)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.error).to.exist;
          expect(res.body.error.message).to.include('Amount must be > 0');
          done();
        });
    });

    it('should reject invalid duration (too short)', (done) => {
      const vaultData = {
        amount: '1000',
        customDuration: 60000, // 1 minute (< 30 minutes)
        sourceChain: 84532,
        destinationChain: 26,
        bridgeProtocol: 'CCTP',
        tokenAddress: '0x036CbD53842c5426634C78482c0467f5C4738dF1',
        vaultType: 'FIXED'
      };

      request(app)
        .post('/api/vaults/create')
        .set('Authorization', `Bearer ${testJWT}`)
        .send(vaultData)
        .expect(400)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.error.message).to.include('Invalid duration');
          done();
        });
    });

    it('should reject invalid duration (too long)', (done) => {
      const vaultData = {
        amount: '1000',
        customDuration: 31536000001, // 365+ days
        sourceChain: 84532,
        destinationChain: 26,
        bridgeProtocol: 'CCTP',
        tokenAddress: '0x036CbD53842c5426634C78482c0467f5C4738dF1',
        vaultType: 'FIXED'
      };

      request(app)
        .post('/api/vaults/create')
        .set('Authorization', `Bearer ${testJWT}`)
        .send(vaultData)
        .expect(400)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.error.message).to.include('Invalid duration');
          done();
        });
    });

    it('should reject invalid vault type', (done) => {
      const vaultData = {
        amount: '1000',
        customDuration: 604800000,
        sourceChain: 84532,
        destinationChain: 26,
        bridgeProtocol: 'CCTP',
        tokenAddress: '0x036CbD53842c5426634C78482c0467f5C4738dF1',
        vaultType: 'INVALID'
      };

      request(app)
        .post('/api/vaults/create')
        .set('Authorization', `Bearer ${testJWT}`)
        .send(vaultData)
        .expect(400)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.error.message).to.include('Invalid vault type');
          done();
        });
    });

    it('should require authentication', (done) => {
      const vaultData = {
        amount: '1000',
        customDuration: 604800000,
        sourceChain: 84532,
        destinationChain: 26,
        bridgeProtocol: 'CCTP',
        tokenAddress: '0x036CbD53842c5426634C78482c0467f5C4738dF1',
        vaultType: 'FIXED'
      };

      request(app)
        .post('/api/vaults/create')
        .send(vaultData)
        .expect(401)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });

    it('should support both vault types', (done) => {
      const vaultDataFixed = {
        amount: '1000',
        customDuration: 604800000,
        sourceChain: 84532,
        destinationChain: 26,
        bridgeProtocol: 'CCTP',
        tokenAddress: '0x036CbD53842c5426634C78482c0467f5C4738dF1',
        vaultType: 'FIXED'
      };

      const vaultDataFlexible = {
        ...vaultDataFixed,
        vaultType: 'FLEXIBLE'
      };

      // Test FIXED
      request(app)
        .post('/api/vaults/create')
        .set('Authorization', `Bearer ${testJWT}`)
        .send(vaultDataFixed)
        .expect(201)
        .end((err, res1) => {
          if (err) return done(err);

          // Test FLEXIBLE
          request(app)
            .post('/api/vaults/create')
            .set('Authorization', `Bearer ${testJWT}`)
            .send(vaultDataFlexible)
            .expect(201)
            .end((err, res2) => {
              if (err) return done(err);
              expect(res1.body.vaultId).to.not.equal(res2.body.vaultId);
              done();
            });
        });
    });
  });

  describe('Vault Routes - GET /api/vaults/:vaultId', () => {
    it('should return vault details', (done) => {
      request(app)
        .get(`/api/vaults/${testVaultId}`)
        .expect('Content-Type', /json/)
        .expect(200, done);
    });

    it('should return vault with deposits and bridge transactions', (done) => {
      request(app)
        .get(`/api/vaults/${testVaultId}`)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body).to.have.property('deposits');
          expect(res.body).to.have.property('bridgeTransactions');
          expect(Array.isArray(res.body.deposits)).to.be.true;
          expect(Array.isArray(res.body.bridgeTransactions)).to.be.true;
          done();
        });
    });

    it('should return 404 for non-existent vault', (done) => {
      const fakeVaultId = '0x' + '0'.repeat(64);
      request(app)
        .get(`/api/vaults/${fakeVaultId}`)
        .expect(404)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.error).to.exist;
          done();
        });
    });
  });

  describe('Vault Routes - GET /api/users/:userAddress', () => {
    it('should return user vaults and transactions', (done) => {
      request(app)
        .get(`/api/users/${testUserAddress}`)
        .expect('Content-Type', /json/)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body).to.have.property('userAddress');
          expect(res.body).to.have.property('vaults');
          expect(res.body).to.have.property('transactions');
          expect(res.body).to.have.property('vaultCount');
          expect(res.body).to.have.property('transactionCount');
          expect(res.body).to.have.property('stats');
          done();
        });
    });

    it('should return stats for user', (done) => {
      request(app)
        .get(`/api/users/${testUserAddress}`)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.stats).to.have.property('totalVaults');
          expect(res.body.stats).to.have.property('totalUsers');
          expect(res.body.stats).to.have.property('activeAmount');
          expect(res.body.stats).to.have.property('claimedAmount');
          done();
        });
    });
  });

  describe('Bridge Routes - GET /api/bridge/status/:txHash', () => {
    it('should return bridge transaction status', (done) => {
      const testTxHash = '0x' + '1'.repeat(64);
      request(app)
        .get(`/api/bridge/status/${testTxHash}`)
        .expect('Content-Type', /json/)
        .expect(200, done);
    });
  });

  describe('Bridge Routes - GET /api/bridge/vault/:vaultId', () => {
    it('should return vault bridge transactions', (done) => {
      request(app)
        .get(`/api/bridge/vault/${testVaultId}`)
        .expect('Content-Type', /json/)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(Array.isArray(res.body)).to.be.true;
          done();
        });
    });
  });

  describe('Proof of Reserves Routes - GET /api/proof-of-reserves', () => {
    it('should return current proof of reserves', (done) => {
      request(app)
        .get('/api/proof-of-reserves')
        .expect('Content-Type', /json/)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body).to.have.property('totalLocked');
          expect(res.body).to.have.property('totalVaults');
          expect(res.body).to.have.property('verified');
          done();
        });
    });

    it('should return breakdown by chain', (done) => {
      request(app)
        .get('/api/proof-of-reserves')
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body).to.have.property('byChain');
          expect(typeof res.body.byChain).to.equal('object');
          done();
        });
    });

    it('should return breakdown by token', (done) => {
      request(app)
        .get('/api/proof-of-reserves')
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body).to.have.property('byToken');
          expect(typeof res.body.byToken).to.equal('object');
          done();
        });
    });
  });

  describe('Proof of Reserves Routes - GET /api/proof-of-reserves/history/:limit', () => {
    it('should return reserves history with default limit', (done) => {
      request(app)
        .get('/api/proof-of-reserves/history')
        .expect('Content-Type', /json/)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body).to.have.property('count');
          expect(res.body).to.have.property('history');
          expect(Array.isArray(res.body.history)).to.be.true;
          done();
        });
    });

    it('should respect custom limit parameter', (done) => {
      request(app)
        .get('/api/proof-of-reserves/history/50')
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.count).to.be.lessThanOrEqual(50);
          done();
        });
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent route', (done) => {
      request(app)
        .get('/api/nonexistent')
        .expect(404)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.error).to.exist;
          done();
        });
    });

    it('should handle invalid JSON in request body', (done) => {
      request(app)
        .post('/api/vaults/create')
        .set('Authorization', `Bearer ${testJWT}`)
        .set('Content-Type', 'application/json')
        .send('invalid json {')
        .expect(400, done);
    });

    it('should enforce rate limiting', (done) => {
      // Make multiple rapid requests to same endpoint
      let requestCount = 0;
      const maxRequests = 101;

      const makeRequest = () => {
        request(app)
          .get('/health')
          .end((err, res) => {
            requestCount++;
            if (requestCount === maxRequests) {
              // Last request should be rate limited
              expect(res.status).to.equal(429);
              done();
            } else if (requestCount < maxRequests) {
              makeRequest();
            }
          });
      };

      makeRequest();
    });
  });

  describe('CORS & Security Headers', () => {
    it('should include security headers', (done) => {
      request(app)
        .get('/health')
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          // Helmet should set security headers
          expect(res.headers).to.have.property('x-content-type-options');
          done();
        });
    });

    it('should allow CORS from allowed origins', (done) => {
      request(app)
        .get('/health')
        .set('Origin', 'http://localhost:3000')
        .expect(200, done);
    });
  });

  describe('Request/Response Format', () => {
    it('should accept and return JSON', (done) => {
      const vaultData = {
        amount: '1000',
        customDuration: 604800000,
        sourceChain: 84532,
        destinationChain: 26,
        bridgeProtocol: 'CCTP',
        tokenAddress: '0x036CbD53842c5426634C78482c0467f5C4738dF1',
        vaultType: 'FIXED'
      };

      request(app)
        .post('/api/vaults/create')
        .set('Authorization', `Bearer ${testJWT}`)
        .set('Content-Type', 'application/json')
        .send(vaultData)
        .expect('Content-Type', /json/)
        .expect(201, done);
    });

    it('should include timestamp in responses', (done) => {
      request(app)
        .get('/health')
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.timestamp).to.exist;
          expect(new Date(res.body.timestamp)).to.be.an.instanceof(Date);
          done();
        });
    });
  });

  describe('Vault Operations Integration', () => {
    it('should create and retrieve vault', (done) => {
      const vaultData = {
        amount: '1000',
        customDuration: 604800000,
        sourceChain: 84532,
        destinationChain: 26,
        bridgeProtocol: 'CCTP',
        tokenAddress: '0x036CbD53842c5426634C78482c0467f5C4738dF1',
        vaultType: 'FIXED'
      };

      request(app)
        .post('/api/vaults/create')
        .set('Authorization', `Bearer ${testJWT}`)
        .send(vaultData)
        .expect(201)
        .end((err, res1) => {
          if (err) return done(err);

          const vaultId = res1.body.vaultId;

          // Retrieve created vault
          request(app)
            .get(`/api/vaults/${vaultId}`)
            .expect(200)
            .end((err, res2) => {
              if (err) return done(err);
              expect(res2.body).to.exist;
              done();
            });
        });
    });

    it('should support add deposit operation', (done) => {
      const vaultData = {
        amount: '1000',
        customDuration: 604800000,
        sourceChain: 84532,
        destinationChain: 26,
        bridgeProtocol: 'CCTP',
        tokenAddress: '0x036CbD53842c5426634C78482c0467f5C4738dF1',
        vaultType: 'FIXED'
      };

      request(app)
        .post('/api/vaults/create')
        .set('Authorization', `Bearer ${testJWT}`)
        .send(vaultData)
        .expect(201)
        .end((err, res1) => {
          if (err) return done(err);

          const vaultId = res1.body.vaultId;

          // Add deposit
          request(app)
            .post(`/api/vaults/${vaultId}/add`)
            .set('Authorization', `Bearer ${testJWT}`)
            .send({ amount: '500' })
            .expect(201)
            .end((err, res2) => {
              if (err) return done(err);
              expect(res2.body).to.have.property('newTotal');
              done();
            });
        });
    });

    it('should support claim operation', (done) => {
      const vaultData = {
        amount: '1000',
        customDuration: 604800000,
        sourceChain: 84532,
        destinationChain: 26,
        bridgeProtocol: 'CCTP',
        tokenAddress: '0x036CbD53842c5426634C78482c0467f5C4738dF1',
        vaultType: 'FIXED'
      };

      request(app)
        .post('/api/vaults/create')
        .set('Authorization', `Bearer ${testJWT}`)
        .send(vaultData)
        .expect(201)
        .end((err, res1) => {
          if (err) return done(err);

          const vaultId = res1.body.vaultId;

          // Claim vault
          request(app)
            .post(`/api/vaults/${vaultId}/claim`)
            .set('Authorization', `Bearer ${testJWT}`)
            .send({ destinationChain: 26 })
            .expect(200)
            .end((err, res2) => {
              if (err) return done(err);
              expect(res2.body).to.have.property('status', 'CLAIMED');
              done();
            });
        });
    });
  });
});
