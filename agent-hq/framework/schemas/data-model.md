# Data Schemas (v0.1)

Framework-level schemas. Implementation details (column types, indexes) defined during HQ build.

## Thread (email state cache)
```
ThreadID            string        // Gmail thread ID or Outlook conversation ID
Source              enum          // "gmail" | "outlook"
Subject             string
Participants        [string]      // email addresses
LastSenderEmail     string
LastSenderType      enum          // "jonathan" | "client" | "agent" | "lawyer" | "lender" | "internal" | "auto-notif"
LastMessageDate     datetime
State               enum          // "awaiting_you" | "draft_ready" | "awaiting_them" | "closed" | "snoozed"
DraftID             string?       // Gmail draft resource ID when state = draft_ready
LinkedPropertyID    string?
LinkedDealID        string?       // FUB deal ID
LinkedContactID     string?       // FUB contact ID
Priority            enum          // "p0" | "p1" | "p2"
Tags                [string]
```

## Lead (mirror of FUB contact, cached)
```
FubContactID        string
Name                string
Email               string
Phone               string
Source              string        // e.g., "SP: Networking"
Tags                [string]      // includes "Advocate", "Listing Appointment", stage tags
Stage               enum          // Hot | Warm | Nurture | Past
AssignedAgent       string        // Jonathan
CreatedAt           datetime
FirstTouchDraftedAt datetime?
FirstTouchSentAt    datetime?
EngagementNotes     text?         // appended from Faris Engagement dept follow-up email
```

## Deal (mirror of FUB deal, cached)
```
FubDealID           string
Address             string
Side                enum          // "listing" | "buyer"
Stage               enum          // "active-listing" | "conditional" | "firm" | "pending-close" | "closed" | "expired"
ListPrice           money?
SalePrice           money?
Commission          money?
AcceptedDate        date?
IrrevocableDate     date?
ConditionalPeriod   interval?
Conditions          [Condition]
TitleSearchDate     date?
ClosingDate         date?
PossessionDate      date?
Seller              ContactRef?
Buyer               ContactRef?
CoopAgent           AgentRef?
Lawyer              ContactRef?
Lender              ContactRef?
FubContactID        string        // linked lead/contact
NotesPdfPath        string?       // parsed APS PDF link in FUB
```

## Condition (sub-record of Deal)
```
Type                enum          // "financing" | "inspection" | "status_cert" | "septic" | "well" | "insurance" | "custom"
Description         string        // for "custom"
RemovalDate         date
Status              enum          // "pending" | "cleared" | "waived" | "extended"
RemindersCreated    bool
```

## Listing (extended Deal for active listings)
```
FubDealID           string        // FK
ListDate            date
DaysOnMarket        int
ShowingsTotal       int
ShowingsThisWeek    int
FeedbackReceived    int
Day14ReviewDate     date          // pre-booked
Day21ReviewDate     date          // pre-booked
Day30ReviewDate     date          // pre-booked
CadenceAdditionalTouchesPerWeek  int  // 1 or 2 (configurable)
RelistCount         int
OriginalListPrice   money
CurrentListPrice    money
```

## Showing (BrokerBay-sourced)
```
BrokerBayID         string
PropertyAddress     string
ShowingAgent        string        // name + email
ShowingAgentPhone   string?
Date                datetime
Duration            interval
Type                enum          // "Buyer/Broker" | "Home Inspection" | ...
Status              enum          // "requested" | "confirmed" | "cancelled" | "completed"
FeedbackReceivedAt  datetime?
FeedbackSummary     text?
FeedbackTone        enum?         // "positive" | "mixed" | "negative"
AgentFollowUpDraftedAt datetime?  // 10-14 day follow-up (buyer showings)
```

## Task (mirror of FUB task)
```
FubTaskID           string
Title               string
DueDate             datetime
AssignedTo          enum          // "jonathan" | "jo"
Status              enum          // "open" | "in_progress" | "done" | "overdue"
LinkedDealID        string?
LinkedContactID     string?
Source              enum          // "agent_auto" | "jonathan" | "jo_eod" | "contract_milestone"
```

## JoDtlRecord (daily)
```
Date                date
Priorities          [string]      // top 3
Appointments        [string]
Calls               [string]
ListingsActions     [{Address, NextAction}]
AdminDecisions      [string]      // back to Jonathan
PersonalReminders   [string]
Carryover           [string]
CalendarBlocksAdded [string]
SentAt              datetime
EodReceivedAt       datetime?
EodCompleted        [string]
EodCarryover        [string]
EodQuestions        [string]
EodRedFlags         [string]
EodYellowFlags      [string]
```

## ContactRef / AgentRef
```
Name                string
Email               string?
Phone               string?
Company             string?
FubContactID        string?
```

## AuditLogEntry
```
Timestamp           datetime
Action              enum
Actor               string        // "agent"
Target              string        // thread ID, task ID, etc.
Details             json
```
