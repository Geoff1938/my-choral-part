# Payment & Advertising Implementation Plan

## Overview
Plan for implementing a freemium model with advertising and paid ad-free usage time.

## Business Model
- Free version: Shows ads after X hours of usage
- Paid option: Purchase ad-free time (e.g., 4 hours for $Y)
- No user accounts required (minimal friction)

## Recommended Approach: Hybrid System

### Architecture
Simple client-side tracking with server-side payment validation - balances simplicity with security.

### Components

#### 1. Payment Flow
```
User donates → Stripe checkout → Success redirect with code
→ User enters code in app → Server validates → Client stores time
```

#### 2. Server Changes (Minimal)
**New endpoint:** `POST /api/verify-payment`
- Input: Payment code from Stripe
- Validates with Stripe API
- Returns: `{ valid: true, seconds: 14400, signature: "..." }`
- Signature prevents client-side forgery

**Dependencies:**
- Stripe Node.js SDK
- Environment variable for Stripe secret key

#### 3. Client-Side Tracking (localStorage)
**Stored data:**
```javascript
{
  paidSeconds: 14400,           // Remaining paid time
  purchaseTimestamp: 1234567890,
  signature: "encrypted-hash",  // Prevents tampering
  totalUsageSeconds: 3600       // Total usage (for free tier limit)
}
```

**Tracking logic:**
- Update every 10 seconds during playback
- Decrement from paid balance first, then free balance
- Show ads when: `paidSeconds === 0 && totalUsageSeconds > FREE_LIMIT`

#### 4. Ad Integration
- Display ads between movements or as overlay
- Respect paid users' status
- Options: Google AdSense, other networks

### Implementation Steps

1. **Phase 1: Usage Tracking (No payments yet)**
   - Add playback time tracking to MIDIPlayer
   - Store in localStorage
   - Display usage stats to user
   - Test accuracy

2. **Phase 2: Ad Integration**
   - Choose ad network
   - Implement ad display logic
   - Show ads after free limit reached
   - Add "Remove ads" prompt

3. **Phase 3: Payment System**
   - Set up Stripe account
   - Create payment endpoint on server
   - Implement payment validation with signature
   - Add "Enter code" UI
   - Test with Stripe test mode

4. **Phase 4: Polish**
   - Add usage dashboard in Settings tab
   - Show remaining paid time
   - Add "Purchase more time" link
   - Legal: Privacy policy, terms of service

### Security Considerations

**Pros:**
- Payment validation prevents fake purchases
- Signature prevents localStorage tampering
- Minimal server complexity/cost

**Known limitations:**
- Determined users could share payment codes
- Clearing browser data resets free usage counter
- For niche choral app, this is likely acceptable

**If abuse becomes problem:**
- Upgrade to full server-side tracking
- Add device fingerprinting
- Implement user accounts

### Cost Estimate

**Time:** 3-5 days implementation
**Ongoing costs:**
- Stripe fees: 2.9% + $0.30 per transaction
- Minimal server load increase (payment validation only)
- No database hosting needed for this approach

### Alternative: Full Server Tracking

If stricter enforcement needed later:
- Add PostgreSQL database
- Track usage server-side per device/user
- Requires user authentication or device fingerprinting
- Significantly more complex
- Higher server costs
- See conversation for full details

---

## Decision Point

Start with hybrid approach because:
1. Most users are honest
2. Low development time
3. Minimal server costs
4. Can upgrade to server tracking if needed
5. No user account friction

## Next Steps When Ready

To implement this, ask Claude:
> "Can you implement the hybrid payment and ads system as described in docs/payment-ads-implementation-plan.md?"

---

*Document created: 2025-10-28*
*Based on conversation about monetization strategy*
