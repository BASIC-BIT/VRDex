# Group and instance analytics

Vocabulary for the group analytics design discussion.

## Language

**VRChat group**:
A VRChat community whose membership and associated instances are the subject of analytics.
_Avoid_: Guild, when referring to the VRChat entity.

**Primary connected group**:
The one VRChat group connected to a club's bot integration and analytics in this release.

**Additional group link**:
A link from a club profile to another VRChat group. The link does not connect that group to analytics or prove control of it.

**Instance population**:
The number of people present in an instance at a particular time, distinct from the identities of those people.
_Avoid_: Members, when the intended meaning is all occupants.

**Named attendance history**:
Records associating identifiable people with their observed attendance in an instance over time.
_Avoid_: Population history, when individual people are meant.

**Group-member versus guest breakdown**:
A classification of instance occupants by whether they belong to the associated VRChat group at the relevant time. Unresolved membership is distinct from guest status.

**VRDex group account**:
A VRDex-owned VRChat account assigned to connect to a group's analytics. Membership in the group does not itself mean the account is present inside an instance.

**Club staff**:
People granted a role in managing a club's VRDex community. Being a member of the connected VRChat group does not itself grant a VRDex staff role.

**Club staff role**:
A club-managed VRDex role assigned to staff and used to grant action permissions and access to staff-only information. VRChat group roles do not create or synchronize these assignments.

**Club owner**:
The single person holding ownership authority for a club's VRDex community. Ownership is separate from ordinary staff roles and provides access to owner-only information.

**Data audience**:
The people permitted to read a category of club information: public, staff-only, or owner-only. For staff-only information, the owner chooses eligible club staff roles or all staff.

**Action permission**:
Authority to perform a club-management action, such as managing staff or connecting an integration. Permission to read information does not itself grant permission to change it.

**Personal attendance history**:
A future, opt-in record for a person of clubs and scheduled sets they were observed attending. Observed presence does not establish that the person listened to a performance.
