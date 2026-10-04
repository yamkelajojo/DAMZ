# DAMZ

DAMZ is an anonymous, local-first delivery marketplace for a small fixed catalog of
goods, running over Tor with peer-to-peer order chats and no accounts.

## Language

**Persona**:
A participant role in a trade. There are exactly three: Customer, Runner, Admin.
_Avoid_: user, account, actor

**Customer**:
The persona that places an order and receives delivery.
_Avoid_: buyer, client, user

**Runner**:
The persona that accepts an order, procures the goods, and delivers them. The runner
sets their own prices and delivery radius.
_Avoid_: driver, courier, seller, vendor, salesman

**Admin**:
The single authority that approves and bans runners, adjudicates disputes, and issues
strikes. In this project the Admin and the developer are the same person.
_Avoid_: operator, moderator, owner

**Catalog**:
The fixed set of seven goods that may be ordered. Each Runner marks items available or
unavailable and sets their own price; there are no inventory counts.
_Avoid_: inventory, products, stock, menu

**Order**:
A peer-to-peer agreement between one Customer and one Runner for delivery of catalog
items to a location. An order is not a shared server object; each side holds its own
copy and they reconcile by messages.
_Avoid_: purchase, transaction, cart, job

**Order status**:
The single state field on an order. The Runner owns its transitions; the Customer owns
only final confirmation.
_Avoid_: state, phase

**Delivery address**:
The destination for an order. Stored exactly only inside the encrypted order chat; the
Runner may keep a coarse geohash locally for navigation.
_Avoid_: location, drop

**Strike**:
A moderation penalty recorded against a Customer by the Admin. Three strikes are a ban.
Strikes are authoritative on the Admin service, not on the device.
_Avoid_: warning, flag, infraction

**Dispute**:
A Customer-raised complaint about an order that the Admin adjudicates, reviewing only
evidence the Customer voluntarily shares.
_Avoid_: claim, complaint, case

**Runner registry**:
The Admin service's list of known Runners, keyed by DID, with approval and ban status.
It holds no personal information.
_Avoid_: directory, roster

**Proof bundle**:
The encrypted evidence a Runner uploads after delivery: a hardware-signed photo, a
zero-knowledge location proof, and metadata. Only a content identifier (CID) of it is
shared; the key to decrypt it is sent separately over the encrypted chat.
_Avoid_: receipt, evidence, delivery proof

**Payment provider**:
The swappable component that turns an order into a payable request and reports its
status. v1 uses a mock implementation; a real Monero gateway is a later adapter.
_Avoid_: gateway, processor (when meaning the interface)
