	

CAPSTONE PROJECT REGISTER

3. Register content of Capstone Project
(*) 3.1. Capstone Project name:
English: SignTrustMap: A Crowd-AI Platform for Building a Reliable Traffic Sign Inventory
Vietnamese: SignTrustMap: Nền tảng kết hợp AI và cộng đồng để xây dựng cơ sở dữ liệu biển báo giao thông tin cậy
Abbreviation: STM

Context:
The modern transportation landscape is experiencing a major transformation driven by Advanced Driver Assistance Systems (ADAS), Level 3+ autonomous driving, and intelligent logistics optimization. These systems require accurate, timely, and localized spatio-temporal road attribute data, especially physical traffic signs such as speed limits, turn restrictions, prohibited movements, and temporary lane configurations. However, standard navigation applications and static geometric maps are often insufficient because traffic sign information changes over time and must be continuously updated to support safety, legal compliance, and route efficiency.
Despite this demand, conventional mapping providers and collaborative platforms such as OpenStreetMap (OSM) still face significant challenges in maintaining up-to-date traffic sign inventories. Dedicated mobile mapping vehicles equipped with LiDAR sensors and high-end cameras are costly to deploy frequently, while crowdsourcing data from regular road users’ dashcams and mobile devices introduces noisy, redundant, geographically imbalanced, and potentially fraudulent data, including duplicated evidence, spam submissions, and GPS spoofing.
On the technical side, many AI-based traffic sign recognition systems remain limited to isolated offline experiments or single-inference APIs. They usually focus on model accuracy while overlooking the complete software engineering lifecycle needed for real deployment, including large-scale data ingestion, video-GPX synchronization, spatio-temporal object tracking, duplicate elimination, coordinate projection, human-in-the-loop validation, reviewer reliability management, active learning, model retraining, and long-term data governance.
SignTrustMap (STM) is designed to address these gaps as an automated, community-driven MLOps and GIS platform for building and maintaining a reliable traffic sign inventory. The system ingests street-level dashcam videos and companion GPX trajectory files, detects and classifies traffic signs through an AI pipeline, estimates their spatial positions, and routes selected candidates to a peer-to-peer reviewer validation workspace before publishing verified signs to an interactive GIS map and spatial-indexed database.
To support sustainable community participation and continuous taxonomy growth, STM also integrates a credit-based wallet economy and a controlled Traffic Sign Catalog. Contributors can earn credits by submitting survey data, validating sign candidates, completing revalidation tasks, or claiming daily rewards, while Drivers may spend credits on premium navigation-related services. The Traffic Sign Catalog standardizes sign types, representative images, labeling guidelines, AI label prompts, and mapping rules. When users encounter signs outside the current taxonomy, missing sign-type reports can be reviewed, merged, rejected, or approved, allowing both the catalog and the AI label set to evolve over time.
Proposed Solution:
SignTrustMap establishes an end-to-end automated MLOps and GIS platform integrated with a decentralized peer-to-peer (P2P) community validation workspace. Daily drivers acting as Surveyors upload street-level dashcam videos, companion GPX trajectory logs, or individual sign photos; the platform synchronizes video frames with GPS telemetry, tracks traffic signs across video sequences to eliminate duplicates, estimates physical sign coordinates using camera geometry, classifies candidates using an AI pipeline, and distributes selected cases to community Reviewers for validation. Verified signs are stored in a spatial-indexed database and published to an interactive GIS map for Driver navigation and sign-based alerts. To support sustainable participation and long-term taxonomy growth, the platform also integrates a credit-based wallet economy, top-up/payment processing, a controlled Traffic Sign Catalog for labeling reference and AI label prompts, and a missing sign type workflow that allows Staff and Admins to review, merge, reject, or approve new sign types when users encounter signs outside the existing catalog.
End-to-End System Pipeline and Closed-Loop Architecture:
 
Figure 1. End-to-End System Pipeline and Closed-Loop MLOps Architecture of SignTrustMap (ASM)
The proposed solution executes a continuous, closed-loop processing stream as illustrated in Figure 1:
1.	Ingestion & Dual-Path Processing: 
o	The Surveyor uploads raw videos and companion GPX logs.
o	YOLO12 tracks traffic signs across video frames, extracting a single Best Frame (highest clarity and largest bounding box) to prevent duplicates.
o	The Vision Path: The cropped sign is processed by a CLIP Vision-Language Model (VLM) to obtain high-dimensional vector embeddings for initial classification.
o	The Geometric Path: The system estimates the relative physical distance (d) from the camera focal length and the pixel bounding box height. It also identifies the traffic flow direction (road orientation) to classify whether the vehicle is traveling toward the front face of the sign (before the sign) or away from it (after the sign). It projects the sign's geographical coordinates by translating the vehicle's GPS coordinate along its bearing angle (θ) by distance (d). Both cropped assets and projected coordinates are stored in the Unverified Traffic Sign Pool, along with orientation properties.
2.	Active Selection & Peer Review: 
o	An Active Learning Engine screens the pool and selects samples based on two criteria: low-confidence predictions ("Beneficial Signs" to improve the model) and high-confidence predictions ("Confident Signs" for rapid map updating).
o	Regardless of the selection criteria, both streams are routed to a unified validation queue. Community Reviewers access a fast-paced workspace to validate all candidates using a simple Yes/No (Approve/Reject) hotkey flow, minimizing cognitive load and maximizing throughput.
3.	Consensus, Map Publishing & Feedback Loop: 
o	A weighted consensus algorithm evaluates reviewer votes by factoring in reviewers' reliability scores, community approvals, and rejections. Signs that meet the predefined consensus threshold are published live on the interactive GIS Map (OpenStreetMap).
o	The verified community labels are fed back to fine-tune both the YOLO12 detector and the CLIP classifier, establishing a self-improving active learning loop.
Detailed Business Flows & Specifications:
Flow 1**: Survey Submission
●	Purpose: Allow Surveyors to submit road-survey data that can later be processed into traffic sign candidates.
●	Primary Actor: Surveyor 
●	Trigger: The Surveyor starts a new data contribution.
●	Preconditions: The Surveyor is authenticated and has permission to submit survey data.
●	Input: Video/image with timestamp metadata; GPX trajectory with GPS coordinates. 
●	Main Flow:
○	The Surveyor opens the survey submission workspace.
○	The Surveyor chooses one submission method: record a new trip, upload an existing video-GPX pair, or submit a single sign photo.
○	The platform validates the submitted files, including format, size, readability, GPS availability, and required metadata.
○	The Storage Service saves the valid media files and metadata.
○	The platform creates a survey submission record.
○	The Submission Queue places the submission into the background processing queue.
○	The Surveyor can view the submission status in the processing monitor or submission history.
●	Alternative Flows:
○	If the file format is invalid, the submission is rejected, and the Surveyor is asked to upload a supported file.
○	If required GPS or timestamp metadata is missing, the submission is marked as pending correction.
○	If the upload is interrupted, the platform allows the Surveyor to resume the upload using the chunked upload mechanism.
●	Output: A survey submission record is created, the submitted media files are stored, and the submission is marked as queued for sign extraction. If validation fails, the submission is marked as rejected or pending correction. 

Flow 2: Submission Tracking 
●	Purpose: Allow Surveyors to monitor the processing status, extraction result, and contribution outcome of their submitted survey data. 
●	Primary Actor: Surveyor 
●	Trigger: The Surveyor opens the submission history or processing monitor after submitting survey data. 
●	Preconditions: The Surveyor is authenticated. At least one survey submission record exists under the Surveyor’s account. 
●	Input: Survey submission record, upload metadata, processing status, extraction progress, detected candidate summary, validation result, failure reason, and reward result. 
●	Main Flow:
○	The Surveyor opens the submission history or processing monitor.
○	The platform displays the Surveyor’s submitted survey records.
○	The Surveyor selects a submission to view its processing details.
○	The platform displays the submission metadata, including submission method, upload time, media type, file status, GPS metadata status, and current processing status.
○	The platform shows the current processing stage, such as queued, synchronizing, detecting signs, tracking detections, estimating coordinates, classifying signs, storing candidates, completed, partially processed, failed, rejected, pending correction, or no sign detected.
○	The platform displays the number of extracted traffic sign candidates once candidate extraction is complete.
○	The platform displays the processing result, including whether the submission produced valid candidates, failed validation, produced no signs, or requires correction.
○	If valid candidates are created, the platform indicates that they have been sent to the validation queue.
○	If rewards are applicable, the platform displays the calculated survey reward or pending reward status.
○	The Surveyor can view historical submissions, filter submissions by status, and inspect contribution statistics. 
●	Alternative Flows:
○	If the Surveyor has no submission records, the platform displays an empty submission history and provides an option to create a new survey submission.
○	If a submission is still queued or processing, the platform displays the latest available progress status.
○	If processing fails, the platform displays the reason for the failure and marks the submission as failed.
○	If required metadata is missing, the platform marks the submission as pending correction and displays the required correction information.
○	If no traffic sign is detected, the platform marks the submission as no-sign-detected.
○	If only part of the submitted media can be processed successfully, the platform marks the submission as partially processed and displays the summary of the processed results.
○	If reward calculation is pending, the platform displays the reward status as pending until the related processing or validation condition is completed. 
●	Output: The Surveyor can view the status, processing progress, extraction summary, failure or correction reason, candidate generation result, reward status, and historical contribution records for submitted survey data. 

Flow 3**: Sign Extraction
●	Purpose: Convert queued survey submissions into unverified traffic sign candidates. 
●	Primary Actor: AI Processing Service 
●	Trigger: A survey submission is marked as queued for sign extraction. 
●	Preconditions: The queued survey submission is available, and the Traffic Sign Catalog label set is active. 
●	Input: Queued survey submission record. 
●	Main Flow:
○	The AI Processing Service retrieves the queued survey submission.
○	The service synchronizes submitted media with timestamp and GPS trajectory data.
○	The service detects traffic signs from the submitted media using YOLO12.
○	For video submissions, the service tracks repeated detections across consecutive frames using BoT-SORT.
○	The service selects the best representative frame for each detected physical sign.
○	The service crops the traffic sign region from the selected frame or submitted image.
○	The service estimates the sign coordinate using GPS trajectory data, heading information, camera geometry, and projection logic.
 
 
○	For video-based submissions, the service determines the sign's applicable traffic direction using trajectory and tracking information.
○	The service classifies the cropped sign image using CLIP and the active Traffic Sign Catalog labels.
○	The service stores the extracted sign data in the unverified traffic sign pool. 
●	Alternative Flows:
○	If the submitted media cannot be read, the submission is marked as failed.
○	If synchronization fails for all media records, the submission is marked as failed. If synchronization succeeds for only part of the media, the submission is marked as partially processed.
○	If no traffic sign is detected, the submission is marked as no-sign-detected.
○	If classification confidence is low, the candidate is still stored for reviewer validation.
○	If coordinate estimation is unreliable, the candidate is stored with a low spatial-confidence flag. 
○	If trajectory information is unavailable for a single-photo submission, the candidate is stored without traffic direction and marked for reviewer confirmation.
●	Output: One or more unverified traffic sign candidates are created from the queued survey submission. If processing fails, the submission is marked as failed, partially processed, or no sign detected. 

Flow 4**: Candidate Review
●	Purpose: Allow Reviewers to validate unverified traffic sign candidates before they can become verified map data. 
●	Primary Actor: Reviewer 
●	Trigger: The Reviewer opens the review workspace and selects a candidate from the validation queue.
●	Preconditions: The Reviewer is authenticated to review sign candidates.
●	Input: Unverified traffic sign candidate. 
●	Main Flow:
○	The Reviewer opens the candidate review workspace.
○	The platform loads an available unverified traffic sign candidate from the validation queue.
○	The platform displays the sign crop, the AI-predicted label, the confidence score, the estimated map location, the traffic direction, and the original frame context.
○	The Reviewer checks whether the candidate is a valid traffic sign.
○	The Reviewer compares the candidate with the Traffic Sign Catalog if label confirmation is needed.
○	The Reviewer submits a decision: approve, reject, suggest a corrected label, or flag the candidate.
○	The platform records the Reviewer’s decision, the timestamp, the selected label, if any, and the review metadata.
○	The platform updates the candidate’s review status and vote set.
○	The Reviewer can continue reviewing another candidate or view review history and performance metrics. 
●	Alternative Flows:
○	If the candidate image is blurry or unreadable, the Reviewer flags it as invalid or low quality.
○	If the predicted label is incorrect, the Reviewer selects a corrected label from the Traffic Sign Catalog.
○	If the correct sign type does not exist in the catalog, the Reviewer reports a missing sign type.
○	If the candidate appears duplicated, fraudulent, or suspicious, the Reviewer flags it for moderation. 
●	Output: A review decision is recorded for the unverified traffic sign candidate. The candidate remains pending if more reviews are required, or becomes ready for consensus evaluation if the review condition is met. 

Flow 5**: Consensus Publishing
●	Purpose: Determine the final status of reviewed traffic sign candidates and publish approved signs to the verified map.
●	Primary Actor: Consensus Engine 
●	Trigger: A candidate reaches the minimum number of reviewer decisions required for consensus evaluation. 
●	Preconditions: The candidate has valid reviewer decisions, and consensus thresholds are configured. 
●	Input: Reviewed traffic sign candidate with recorded reviewer decisions. 
●	Main Flow:
○	The Consensus Engine retrieves the reviewed traffic sign candidate.
○	The engine calculates the weighted consensus score based on reviewer votes and reviewer reliability scores:
 
where w_Reviewer_i is the reliability score of reviewer i, and V_i is the reviewer vote value, with 1 for Approve and -1 for Reject.
○	The engine compares the consensus score with the approval and rejection thresholds.
○	If the approval threshold is reached, the engine confirms the final sign label, coordinate, traffic direction, and metadata.
○	The platform writes the approved candidate into the verified traffic sign database.
○	The verified sign is published to the interactive GIS map.
■	After a final consensus outcome is reached, the platform updates each reviewer’s reliability score using:
 
where α ∈ (0, 1) is the system smoothing factor (e.g., α = 0.1), and A is the alignment evaluation of the reviewer's vote against the final community outcome:
 
○	If the rejection threshold is reached, the candidate is rejected and removed from the active validation queue.
○	If the result is unclear, conflicting, or suspicious, the candidate is escalated to Staff moderation.
○	The platform updates reviewer reliability scores based on alignment with the final consensus outcome.
○	The platform applies reviewer credit rewards when applicable.
○	The platform records the final decision in the audit log.
●	Alternative Flows:
○	If reviewer votes are highly conflicting, the candidate is escalated for Staff moderation.
○	If fraud, duplicate, or GPS-spoofing flags exist, the candidate is not published automatically and is sent to moderation.
○	If a corrected label receives greater consensus than the AI-predicted label, it becomes the final verified label.
○	If consensus cannot be reached, the candidate remains pending or is returned to the validation queue, depending on the system configuration.
●	Output: The reviewed traffic sign candidate is marked as verified, rejected, or escalated. Verified signs become visible on the GIS map, rejected candidates leave the active queue, and escalated cases wait for Staff handling. 

Flow 6*: Map Usage
●	Purpose: Allow Drivers to view, search, filter, and inspect verified traffic signs on the interactive GIS map.
●	Primary Actor: Driver 
●	Trigger: The Driver opens the interactive GIS map.
●	Preconditions: Verified traffic sign data is available in the spatial database, and the GIS map service is accessible.
●	Input: Current map viewport, selected location, search keyword, filter options, and verified traffic sign data.
●	Main Flow:
○	The Driver opens the interactive GIS map workspace.
○	The platform loads the base map and determines the current visible map area.
○	The platform retrieves verified traffic signs located within or near the current map viewport.
○	The platform displays verified traffic signs as markers, clusters, or directional sign indicators on the map.
○	The Driver can pan, zoom, or search for a specific location.
○	The Driver can filter displayed signs by sign type or other supported criteria.
○	The Driver selects a sign marker to view detailed information about the sign.
○	The platform displays the verified sign label, sign image or crop, coordinate, traffic direction, last verified date, and related metadata.
○	The Driver can open the Traffic Sign Catalog to view more information about the selected sign type. 
●	Alternative Flows:
○	If no verified signs exist in the selected map area, the platform displays an empty result message.
○	If the platform cannot retrieve map data, the platform displays an error message and allows the Driver to retry.
○	If too many verified signs are present in the current viewport, the platform groups them via clustering or viewport-based loading.
○	If the Driver applies filters that return no matching signs, the platform displays a no-result message.
○	If the Driver finds incorrect or outdated sign information, they can report the issue via the supported reporting function. 
●	Output: Verified traffic signs are displayed on the interactive GIS map. The Driver can search locations, filter visible signs, and inspect detailed information for selected verified traffic signs.

Flow 7**: Navigation
●	Purpose: Allow Drivers to use verified traffic sign data during route-based navigation and receive traffic sign alerts that match the vehicle’s travel direction. 
●	Primary Actor: Driver 
●	Trigger: The Driver starts active navigation mode by selecting a destination.
●	Preconditions: The Driver is authenticated and has sufficient credits to start active navigation. GPS location access is enabled on the Driver’s device. Routing services and verified traffic sign data are available. 
●	Input: Current GPS location, selected destination, route preference, vehicle heading, planned route, verified traffic sign data, sign traffic direction, and navigation settings. 
●	Main Flow:
○	The Driver opens active navigation mode.
○	The Driver searches for or selects a destination.
○	The platform retrieves the Driver’s current GPS location.
○	The platform calculates a route from the Driver’s current location to the selected destination.
○	The platform displays the planned route on the GIS map.
○	The platform checks the Driver’s credit balance before starting the navigation session.
○	The platform deducts the required credits according to the configured navigation credit rule.
○	The platform starts real-time GPS tracking for the navigation session.
○	The platform continuously updates the Driver’s current location and movement heading.
○	The platform preloads verified traffic signs located along or near the planned route.
○	The platform compares the Driver’s movement heading with each sign’s verified traffic direction.
○	The platform filters out traffic signs that do not apply to the Driver’s current direction of travel.
○	When the Driver approaches a relevant verified traffic sign, the platform triggers an audio or visual alert.
○	The platform updates upcoming sign alerts as the Driver moves along the route.
○	The platform records the navigation session activity and credit transaction.
●	Alternative Flows:
○	If the Driver has insufficient credits, the platform prevents active navigation from starting and asks the Driver to top up credits.
○	If GPS location access is disabled, the platform asks the Driver to enable location permission before starting navigation.
○	If the GPS signal is unstable during navigation, the platform displays a warning and temporarily pauses real-time traffic sign alerts.
○	If the routing service cannot calculate a route, the platform displays an error message and allows the Driver to select another destination or retry.
○	If no verified traffic signs are found along the planned route, the navigation session continues without sign alerts.
○	If a nearby traffic sign does not match the Driver’s direction of travel, the platform does not trigger an alert for that sign.
○	If the Driver deviates from the planned route, the platform recalculates the route and reloads the relevant upcoming traffic signs.
○	If the Driver cancels or exits the navigation session, the platform stops GPS tracking and ends the active navigation session.
●	Output: A route-based navigation session is started, required credits are deducted, relevant verified traffic signs are loaded along the route, and direction-matched traffic sign alerts are provided to the Driver. Navigation session activity and credit transaction records are stored. 

Flow 8*: Revalidation
●	Purpose: Allow the platform and community users to reconfirm, update, or retire existing verified traffic signs when they become outdated or require new evidence. 
●	Primary Actor: Revalidation Service 
●	Trigger: A verified traffic sign reaches the configured freshness threshold or is selected for revalidation. 
●	Preconditions: The verified traffic sign exists in the spatial database. Freshness rules and revalidation reward rules are configured. The Revalidation Task Map is available. 
●	Input: Existing verified traffic sign record, last verified date, previous sign evidence, sign location, freshness threshold, and new user-submitted evidence. 
●	Main Flow:
○	The Revalidation Service periodically checks verified traffic signs stored in the spatial database.
○	The service identifies verified signs that have not been reconfirmed within the configured freshness period.
○	The platform creates a revalidation task for each stale sign.
○	The platform publishes the revalidation task as a task pin on the Revalidation Task Map.
○	A community user opens the Revalidation Task Map and browses available revalidation tasks.
○	The platform loads revalidation task pins based on the current map viewport.
○	The user selects a task pin to view the previous verified sign information, the previous evidence image, the approximate location, the last verified date, the task priority, and the credit reward.
○	The user submits new evidence for the selected task, such as a fresh photo, a short video, or a captured survey frame with a timestamp and GPS metadata.
○	The platform validates the submitted evidence based on file readability, media quality, timestamp, GPS proximity, duplicate status, and relevance to the target sign.
○	Valid evidence is sent to the Reviewer workspace for evaluation.
○	Reviewers compare the new evidence with the existing verified sign record.
○	Reviewers submit a revalidation decision: unchanged, changed, missing, unclear, or invalid.
○	The platform applies the final revalidation result after the required review or consensus condition is met.
○	If the sign remains unchanged, the platform refreshes its last verified date.
○	If the sign has changed, the platform updates the verified sign record and stores the previous version in sign history.
○	If the sign is missing, the platform marks the verified sign as inactive or retired.
○	The platform updates the verified sign layer on the GIS map.
○	The platform applies credit rewards for accepted revalidation evidence when applicable. 
●	Alternative Flows:
○	If no stale signs are found, the platform does not create new revalidation tasks.
○	If the daily submission limit for a revalidation task has been reached, the platform temporarily stops accepting new evidence for that task.
○	If the submitted evidence is unreadable, duplicated, too far from the target location, or irrelevant to the target sign, the platform rejects the evidence.
○	If reviewer decisions are conflicting or unclear, the revalidation case remains pending or is escalated to moderation.
○	If the submitted evidence indicates a sign type not available in the catalog, the user or reviewer can create a missing sign type report.
○	If the user views a revalidation task but does not submit evidence, no credit reward is applied. 
●	Output: The existing verified traffic sign is refreshed, updated, retired, or kept pending for further review. Accepted evidence, reviewer decisions, sign history, map updates, and credit rewards are recorded when applicable. 

Flow 9: Catalog Management 
●	Purpose: Allow authorized and unauthorized users to manage the official Traffic Sign Catalog used for AI classification, reviewer validation, map filtering, and sign information display. 
●	Primary Actor: Admin 
●	Trigger: The Admin opens the Traffic Sign Catalog management workspace.  
●	Preconditions: The Admin is authenticated and has permission to manage catalog data. The catalog database is available.  
●	Input: Sign type information, sign category, sign description, representative images, labeling guidelines, AI label prompts, mapping rules, and catalog version information. 
●	Main Flow:
○	The Admin opens the Traffic Sign Catalog management workspace.
○	The platform displays the current list of traffic sign types and sign categories.
○	The Admin searches, filters, creates, updates, or disables catalog entries.
○	The Admin defines or edits the sign type name, category, description, representative images, labeling guidelines, AI label prompts, and mapping rules.
○	The platform validates required catalog fields and checks for duplicate or conflicting sign types.
○	The Admin saves the catalog changes as a controlled catalog update.
○	The platform publishes the updated catalog version.
○	The updated catalog becomes available in the Reviewer workspace, the map filtering interface, the sign detail view, and the AI classification label set.
○	The platform records the catalog change in the audit log. 
●	Alternative Flows:
○	If required catalog information is missing, the platform prevents the catalog entry from being published and asks the Admin to complete the required fields.
○	If the new or updated sign type duplicates an existing sign type, the platform warns the Admin and allows the Admin to merge, revise, or cancel the change.
○	If representative images are invalid or unreadable, the platform rejects them and asks the Admin to upload valid images.
○	If a catalog update affects active review or classification workflows, the platform synchronizes the updated label set before the new catalog version becomes active.
○	If the Admin cancels the operation before saving, no catalog change is applied. 
●	Output: The Traffic Sign Catalog is created, updated, disabled, merged, or versioned. The published catalog version is synchronized with reviewer workspaces, map filters, sign detail displays, and AI classification labels. 

Flow 10**: Missing Type 
●	Purpose: Allow Reviewers to report traffic sign candidates that do not match any existing sign type in the Traffic Sign Catalog, so Staff and Admins can review the report and update the catalog when necessary. 
●	Primary Actor: Reviewer 
●	Trigger: The Reviewer cannot find a suitable sign type in the Traffic Sign Catalog while reviewing a traffic sign candidate.
●	Preconditions: The Reviewer is authenticated and has permission to review sign candidates. The traffic sign candidate is available in the review workspace. The Traffic Sign Catalog is available for lookup.   
●	Input: Unverified traffic sign candidate, candidate image, AI-predicted label, candidate metadata, current Traffic Sign Catalog, and Reviewer-provided missing type note. 
●	Main Flow:
○	The Reviewer opens a traffic sign candidate in the review workspace.
○	The platform displays the candidate image, the AI-predicted label, the confidence score, the estimated location, the traffic direction, and the original frame context.
○	The Reviewer checks the candidate and compares it with existing sign types in the Traffic Sign Catalog.
○	The Reviewer determines that no suitable sign type exists in the current catalog.
○	The Reviewer selects the missing type reporting function.
○	The Reviewer submits a missing type report with a note explaining why the candidate does not match any existing sign type.
○	The platform creates a missing type report and attaches the candidate image, AI prediction, candidate metadata, location information, traffic direction, source context, and Reviewer note.
○	The platform marks the related candidate as pending resolution of the missing type.
○	Staff opens the missing type report queue.
○	Staff review the report details and check whether the reported sign type already exists in the catalog or duplicates another missing type report.
○	Staff submits a decision: reject the report, merge it with an existing sign type or report, or escalate it to Admin.
○	If the report is escalated, the Admin reviews the missing type report.
○	If the Admin approves the report, they create a new sign type in the Traffic Sign Catalog.
○	The Admin configures the new sign type name, category, description, representative image, labeling guideline, AI label prompt, and mapping rules.
○	The platform publishes the updated version of the Traffic Sign Catalog.
○	The platform synchronizes the new sign type with the Reviewer workspace and the AI classification label set.
○	The platform updates related missing-type candidates so they can be reviewed or reprocessed using the updated catalog.
○	The platform notifies the relevant Reviewer of the final report result.
●	Alternative Flows:
○	If Staff find that the reported sign type already exists in the catalog, Staff merge the report with the existing sign type, and the related candidate can be reviewed using that sign type.
○	If Staff find that the report duplicates another missing type report, Staff merge the reports.
○	If the submitted evidence is insufficient, Staff mark the report as incomplete and, when applicable, request additional information.
○	If the reported object is not a traffic sign, Staff reject the report.
○	If the Admin rejects the escalated report, the report is marked as rejected with a rejection reason.
○	If the catalog update cannot be published immediately, the approved report remains pending catalog publication until the catalog version is successfully released.
●	Output: The missing type report is rejected, merged, escalated, approved, or marked as incomplete. Approved reports result in a new Traffic Sign Catalog entry, an updated catalog version, an updated AI label set, and related candidates becoming available for review or reprocessing with the new sign type.  

Flow 11**: Credit Economy 
●	Purpose: Allow community users to earn, spend, top up, and track credits through platform contribution activities and premium navigation-related services. 
●	Primary Actor: Community User 
●	Trigger: The user opens the wallet dashboard, completes a credit-earning activity, starts a credit-consuming feature, claims a daily reward, or requests a credit top-up. 
●	Preconditions: The user is authenticated. Credit rules, reward rules, top-up packages, and transaction recording rules are configured. 
●	Input: User account, current credit balance, contribution result, reward rule, credit consumption rule, top-up request, payment result, and daily task completion status. 
●	Main Flow:
○	The user opens the wallet or gamification dashboard.
○	The platform displays the current credit balance, transaction history, daily tasks, contribution statistics, and claimable rewards.
○	When the user completes a valid survey submission, candidate review, or revalidation task, the platform calculates the reward based on the configured credit rule.
○	The platform adds the earned credits to the user’s wallet.
○	When the user claims a completed daily task reward, the platform validates the task completion status and adds the configured reward credits.
○	When the Driver starts a premium navigation-related service, the platform checks the Driver’s credit balance.
○	The platform deducts the required credits according to the configured credit consumption rule.
○	If the user requests a credit top-up, the platform displays available top-up packages.
○	The user selects a top-up package and confirms the payment request.
○	The platform forwards the payment request to the Payment Gateway.
○	The Payment Gateway processes the payment and returns the payment result.
○	The platform verifies the payment result before applying any credit change.
○	If the payment is verified successfully, the platform adds the corresponding credits to the user’s wallet.
○	The platform records every earning, spending, reward claim, top-up, refund, and manual adjustment as a credit transaction.
○	The user can view the updated balance and transaction history after each credit operation.  
●	Alternative Flows:
○	If a contribution activity is rejected or does not produce a valid result, no reward credits are added.
○	If a daily task is incomplete, the platform prevents the user from claiming the reward.
○	If the Driver has insufficient credits for a premium navigation-related service, the platform prevents the service from starting and asks the Driver to top up credits.
○	If the payment fails, expires, or is canceled, the platform does not add credits to the user’s wallet.
○	If the payment result is duplicated, invalid, or cannot be verified, the platform does not apply the top-up and records the payment issue for Staff review.
○	If a credit transaction is created incorrectly, Staff or Admin may apply a manual adjustment in accordance with moderation or administration rules.
○	If suspicious reward farming, spam, or abuse is detected, the platform may withhold the reward and route the case to Moderation. 
●	Output: The user’s credit balance is updated after valid earning, spending, top-up, reward, refund, or manual adjustment events. All credit changes are recorded as credit transactions with related activity, payment, or administrative metadata. 


Flow 12: Moderation 
●	Purpose: Allow Staff to handle flagged, suspicious, conflicting, duplicated, low-quality, or abusive activities that cannot be resolved automatically by normal validation, revalidation, or credit rules. 
●	Primary Actor: Staff 
●	Trigger: A candidate, revalidation case, credit transaction, payment issue, user activity, or system record is flagged for manual handling. 
●	Preconditions: The Staff member is authenticated and has moderation permission. The flagged case is available in the moderation queue. 
●	Input: Flagged candidate, review conflict, revalidation case, user report from internal workflow, suspicious activity record, credit transaction, payment issue, user profile, evidence files, and related audit metadata. 
●	Main Flow:
○	The Staff member opens the moderation dashboard.
○	The platform displays flagged cases grouped by case type, priority, status, and creation time.
○	The Staff member selects a moderation case.
○	The platform displays related evidence, candidate data, verified sign data, review decisions, user activity, credit transactions, payment information, and audit history when applicable.
○	The Staff member reviews the case and determines the appropriate action.
○	If the case is related to a traffic sign candidate, Staff may reject the candidate, correct metadata, return it to the validation queue, or escalate it to Admin if required.
○	If the case is related to a verified sign or revalidation result, Staff may correct the sign metadata, send the sign for revalidation, mark the case as unresolved, or escalate it to Admin.
○	If the case involves spam, fake GPS, duplicate evidence, or fraudulent contribution behavior, Staff may reject the activity, withhold rewards, adjust user reliability, or impose user penalties.
○	If the case is related to a credit or payment discrepancy, Staff may review the transaction and request a manual credit adjustment in accordance with platform rules.
○	The platform records the Staff decision, the reason, the affected records, and the timestamp.
○	The platform updates the case status and applies the approved moderation action.
○	The platform writes the moderation action to the audit log. 
●	Alternative Flows:
○	If the case does not contain enough evidence, Staff mark the case as pending additional information.
○	If the case is a duplicate of another moderation case, Staff merge the cases.
○	If the Staff member does not have permission for the required action, the platform prevents the action and requires Admin handling.
○	If the case requires catalog changes, Staff escalate the case to the appropriate Admin catalog management process.
○	If the moderation decision affects user credits, the platform creates or requests a credit adjustment record.
○	If the moderation decision affects a published verified sign, the platform updates the verified sign layer after the correction is applied.
○	If the case cannot be resolved, Staff mark it as unresolved with a reason. 
●	Output: The flagged case is rejected, corrected, returned to review, routed to revalidation, escalated to Admin, merged, kept pending, or marked as unresolved. The platform records the moderation decision, affected records, user impact, credit impact when applicable, and audit information. 

Flow 13: Administration 
●	Purpose: Allow Admins to configure system rules, manage users and roles, monitor audit logs, control platform parameters, and maintain operational governance for SignTrustMap.  
●	Primary Actor: Admin 
●	Trigger: The Admin opens the administration workspace to manage users, roles, system parameters, operational rules, or audit records. 
●	Preconditions: The Admin is authenticated and has administrator permission. Administrative data and configuration services are available. 
●	Input: User account data, role information, permission settings, consensus thresholds, revalidation freshness rules, credit rules, navigation pricing rules, system parameters, audit records, and export criteria.  
●	Main Flow:
○	The Admin opens the administration workspace.
○	The platform displays administrative modules for user management, role management, system configuration, audit monitoring, credit rules, spatial data export, and pipeline control.
○	The Admin can search, view, update, suspend, or reactivate user accounts.
○	The Admin can assign, modify, or revoke user roles and permissions.
○	The Admin configures system parameters such as consensus thresholds, reviewer reliability bounds, revalidation freshness thresholds, task limits, credit reward values, credit consumption rates, and moderation rules.
○	The Admin reviews audit logs, transaction records, background task records, and security-related events.
○	The Admin can export verified traffic sign inventory data using supported spatial or tabular formats.
○	The Admin can review system operation status and background processing configuration.
○	The platform validates configuration changes before applying them.
○	The Admin confirms the administrative action.
○	The platform applies the change, updates the affected configuration or user record, and records the action in the audit log.  
●	Alternative Flows:
○	If the Admin attempts an invalid configuration, the platform rejects the change and displays the validation error.
○	If a role or permission change would remove required administrator access, the platform prevents the unsafe update.
○	If a user account is under active moderation investigation, the platform warns the Admin before applying account changes.
○	If an export request contains unsupported filters or an excessive data range, the platform asks the Admin to revise the export criteria.
○	If a configuration change affects active workflows, the platform applies the change according to versioning or effective-time rules.
○	If the administrative action fails, the platform rolls back the change when possible and records the failure. 
●	Output: User accounts, roles, permissions, system parameters, credit rules, revalidation rules, consensus settings, export records, or operational configurations are created, updated, disabled, exported, or audited. All administrative actions are recorded in the audit log. 

Flow 14*: Active Learning 
●	Purpose: Allow the platform to select valuable traffic sign candidates for human review and use reviewer-verified labels to improve YOLO12 detection and CLIP-based classification over time. 
●	Primary Actor: Active Learning Engine 
●	Trigger: New unverified traffic sign candidates are created, enough reviewed candidates are available, or a scheduled model improvement cycle starts. 
●	Preconditions: Unverified traffic sign candidates are available in the candidate pool. The AI confidence score, candidate metadata, Traffic Sign Catalog label set, and reviewer validation workflow are available. Model training rules and evaluation criteria are configured. 
●	Input: Unverified traffic sign candidates, sign crops, AI-predicted labels, confidence scores, CLIP embeddings, detection metadata, candidate location metadata, reviewer decisions, verified labels, rejected candidates, and active Traffic Sign Catalog labels. 
●	Main Flow:
○	The Active Learning Engine scans the unverified traffic sign pool.
○	The engine evaluates each candidate using AI confidence score, classification uncertainty, metadata quality, spatial relevance, and duplication status.
○	The engine selects uncertain candidates that are useful for improving the detection and classification models.
○	The engine also selects high-confidence candidates for quick review to accelerate map publishing.
○	The platform sends selected candidates to the unified validation queue.
○	Reviewers validate the selected candidates in the Reviewer workspace.
○	The platform records reviewer decisions, corrected labels, rejected candidates, and final consensus outcomes.
○	After consensus publishing, verified labels and approved sign images are collected for training.
○	The platform builds or updates the active learning dataset using verified sign crops, final labels, candidate metadata, and reviewer-confirmed corrections.
○	The platform synchronizes the dataset with the active Traffic Sign Catalog label set.
○	The platform starts the configured model improvement job when the training condition is met.
○	The YOLO12 detector is retrained or fine-tuned using verified sign images and, when applicable, detection-related metadata.
○	The CLIP-based classifier is improved using verified labels, catalog label prompts, sign crops, and corrected reviewer labels.
○	The platform evaluates the updated model or classification configuration against the configured evaluation criteria.
○	If the updated model satisfies the acceptance criteria, the platform marks the model version or classifier configuration as ready for deployment.
○	After approval or automatic release, per the configuration, the platform updates the active AI processing configuration.
○	Future sign extraction jobs use the updated YOLO12 model, the CLIP label configuration, or active-learning selection settings. 
●	Alternative Flows:
○	If no candidate meets the active learning selection criteria, the engine does not add any new candidates to the validation queue for that cycle.
○	If a candidate is duplicated, low quality, unreadable, or spatially unreliable, the engine deprioritizes it or routes it for review with an appropriate flag.
○	If reviewer decisions are conflicting, the candidate remains pending or is handled through the consensus and moderation rules.
○	If there is not enough verified data for retraining, the platform postpones the model improvement job and records the reason.
○	If the training dataset contains inconsistent labels or invalid samples, the platform excludes those records or sends them for manual inspection.
○	If retraining fails, the platform keeps the current active model version and records the failure.
○	If the updated model performs worse than the current model according to evaluation criteria, the platform rejects the update and keeps the existing model active.
○	If a new catalog version changes the label set, the platform synchronizes the CLIP label prompts and candidate classification configuration before future extraction jobs. 
●	Output: Selected candidates are routed to the validation queue for labeling by reviewers. Verified reviewer labels are added to the active learning dataset. YOLO12 and CLIP-based classification configurations are retrained, updated, rejected, or left unchanged based on evaluation results. 
-	
System Architecture:
The SignTrustMap platform utilizes a decoupled, high-performance multi-tier architecture designed to support heavy geospatial calculations, real-time spatial mapping, asynchronous AI pipelines, and high-concurrency client transactions.
●	Presentation Layer (Client-Side):
○	ReactJS (TypeScript, Tailwind CSS): Serves as the primary web application framework, providing a highly responsive user experience across multiple device viewports for surveyors, reviewers, and drivers.
○	React Flow: Utilized in the administrator panels to visually model active learning margins, pipeline configurations, and general MLOps workflows.
○	Mapbox GL & Leaflet.js: Powers responsive, interactive GIS mapping interfaces, handling coordinate visualization, direction heading markers, live routing paths, revalidation task pins, and efficient client-side spatial clustering.
●	Application & Business Logic Layer (Backend Services):
○	FastAPI (Python): Handles high-performance geospatial mathematics, coordinate projections, distance estimations, and asynchronous AI model inference gateways.
○	NestJS (TypeScript): Drives core business logic and database transaction services, managing security, user authentication, role-based access control (RBAC), and gamified credit calculations.
●	Asynchronous Message Broker & Task Processing Layer:
○	Celery: Manages heavy asynchronous background processing workloads, including GPX-video trajectory synchronization, YOLO12 frame scanning, and BoT-SORT tracking queues.
○	Redis (Broker): Acts as the high-speed, in-memory broker facilitating rapid message routing and queue distribution for Celery workers.
●	Storage & Database Layer:
○	PostgreSQL: Functions as the core transactional relational engine, maintaining schemas for users, roles, daily tasks, transaction histories, and administrative audit logs.
○	PostGIS Extension: Integrates spatial capabilities within the relational engine, indexing geographical coordinate points, computing boundary zones, storing sign orientation headings, and executing fast proximity lookup queries.
○	pgvector Extension: Enables vector database indexing and similarity matching directly inside PostgreSQL, storing and querying CLIP high-dimensional image embeddings.
○	MinIO Object Storage: Serves as a localized, highly scalable S3-compatible object storage server to save unstructured files, including surveyor raw videos, GPX trajectory logs, and cropped sign crop patches.
○	Redis (Cache): Provides a high-speed memory cache to optimize navigation coordinate prefetching, shorten lookup intervals, and reduce API response times.
Functional Requirement:
1. Web Application for Admin
●	1.1 Manage User Accounts & Permissions: Central RBAC dashboard to assign, modify, or revoke system roles and user records.
●	1.2 Audit Trails & Log Monitoring: Displays transaction logs, security events, background tasks, and system operations.
●	1.3 Map Override & Data Moderation: Manually adjust coordinate errors, override traffic direction properties, fix sign classifications, or delete malicious database records.
●	1.4 System Parameter Configuration: Configuration workspace for active learning margins, freshness rules, stale thresholds, consensus thresholds, and gamification rules.
●	1.5 Retraining Pipeline Controller: Dashboard to trigger, monitor, and schedule background YOLO12 and CLIP retraining pipelines.
●	1.6 Spatial Data Exporter: Exporters to query, filter, and extract verified road sign inventories in GeoJSON, Shapefile, CSV, or OSM XML formats.
●	1.7 Credit & Payment Management: Admin interface to configure credit reward rules, top-up packages, credit consumption rates, payment transaction monitoring, refund handling, and manual credit adjustment.
●	1.8 Traffic Sign Catalog Management: Admin interface to manage official traffic sign types, sign categories, representative images, labeling guidelines, AI label prompts, and OSM tag mappings.
●	1.9 Missing Sign Type Review: Admin workspace to review escalated missing sign type reports, approve new sign types, reject invalid proposals, or merge proposals with existing catalog entries.
●	1.10 Catalog Version & AI Label Set Control: Admin function to publish catalog versions and synchronize approved sign types with the AI classification label set.
2. Web Workspace for Reviewers
●	2.1 Dynamic Queue Loader: Serve active validation tasks sorted dynamically by Active Learning priorities.
●	2.2 Keyboard-Optimized Validation Workspace: Low-latency UI with keybind controls to Approve, Reject, or Suggest corrected sign labels.
●	2.3 Contextual Evaluation Viewer: Interactive panels showing sign crop assets, GPS locations, calculated traffic direction attributes, classification predictions, and contextual source frames.
●	2.4 Sign Catalog Browser: Searchable and filterable catalog interface allowing Reviewers to look up traffic sign types, view representative images, read labeling guidelines, and compare candidates with official references.
●	2.5 Corrected Label Selection: Interface allowing Reviewers to select a corrected sign label from the catalog when the AI prediction is incorrect.
●	2.6 Missing Sign Type Reporting: Reporting function allowing Reviewers to report candidates that do not match any existing catalog entry and submit supporting evidence for later Staff/Admin review.
●	2.7 Revalidation Review Panel: Interface allowing Reviewers to inspect newly submitted evidence against existing verified records and make maintenance decisions such as Confirm, Update, Retire, Unclear, or Invalid.
●	2.8 Feedback Submission & Reporting: Reporting tools to flag corrupt, low-quality, duplicate, or fraudulent sign submissions for Staff moderation.
●	2.9 Workspace History & Leaderboard: User statistics panel tracking evaluation logs, completion ratios, voting accuracy, credit rewards, reliability scores, and community rankings.
3. Web Portal & Mobile Interface for Surveyors & Drivers (Community)
●	3.1 Unified Authentication: Secure user registration and login using credentials or Google OAuth 2.0.
●	3.2 Chunked Telemetry & Video Uploader: Resumable, chunk-based uploader for large dashcam videos and companion GPX trajectory logs.
●	3.3 Real-Time Processing Monitor: Real-time visual progress trackers showing synchronizing, tracking, projection, direction detection, classification, and queue states.
●	3.4 Interactive GIS Web Map: Interactive map interfaces displaying verified traffic signs with spatial clustering, heading direction indicators, dynamic category filters, and detailed sign attributes.
●	3.5 Traffic Sign Catalog Viewer: Public-facing catalog interface allowing Surveyors and Drivers to browse, search, filter, and view details of supported traffic sign types.
●	3.6 Missing Sign Type Reporter: Interface allowing Surveyors and Drivers to report signs that are not covered by the existing catalog, attach sign images, location information, descriptions, and related evidence.
●	3.7 Revalidation Task Map & Finder: Responsive GIS map dashboard displaying active Revalidation Task pins based on the user’s viewport with filters, detailed task requirements, reward metrics, and daily submission trackers.
●	3.8 Evidence Submitter: Native file uploader allowing users to submit geo-tagged and timestamped sign images, short video clips, or survey frames to fulfill active revalidation tasks.
●	3.9 Smart Active Navigation Mode: Routing calculations, real-time vehicle GPS tracking, pre-fetching upcoming route signs, matching trajectory direction with sign orientation headings, and providing voice alerts.
●	3.10 Gamification & Wallet Hub: Dashboard showcasing credit balances, transaction histories, daily tasks, claimable rewards, reliability indexes, and contribution statistics.
●	3.11 Credit Top-Up Interface: Interface allowing users to select top-up packages, submit payment requests, track payment status, and view top-up transaction results.
4. Background MLOps & Spatial Engine
●	4.1 Spatio-Temporal Synchronizer: Parse GPX trajectories and synchronize video frame timestamps with vehicle coordinates.
●	4.2 Multi-Object Tracking Pipeline: Run asynchronous YOLO12 and BoT-SORT tasks to extract optimal Best Frames and filter redundant crops.
●	4.3 Camera Projection & Orientation Engine: Compute landmark coordinate positions via estimated camera-to-sign distances and vehicle trajectory heading, and automatically resolve traffic flow directionality based on consecutive tracking vectors.
●	4.4 Embedding & Query Classifier: Extract CLIP high-dimensional image embeddings and perform similarity matching with pgvector indices using the latest published Traffic Sign Catalog label set.
●	4.5 Freshness Monitor & Task Generator: Automated scheduled service to scan spatial tables for stale verified signs, evaluate configured freshness rules, generate revalidation tasks, and distribute them to the Revalidation Task Map.
●	4.6 Event-Driven Task Scheduler: Celery background scheduling tasks executing consensus calculation updates, gamified reward payouts, credit transaction updates, and metric cleanups.
●	4.7 Credit Transaction Processor: Background service to create, validate, and apply credit transactions for survey rewards, review rewards, revalidation rewards, daily task rewards, premium feature consumption, refunds, and manual adjustments.
●	4.8 Payment Verification Handler: Service to process payment gateway callbacks, verify top-up results, prevent duplicate payment applications, and reconcile payment records with credit transactions.
●	4.9 Catalog Versioning & Label Set Synchronizer: Background service to publish approved catalog versions and synchronize sign types, label prompts, and AI classification labels across Reviewer workspaces and AI pipelines.
●	4.10 Unknown Candidate Reprocessing Worker: Background worker that reprocesses previously unknown, ambiguous, or missing-type candidates after new sign types are approved and added to the official catalog.
(*) 3.2. Main proposal content (including result and product)  
●	Theory and practice (document): 
o	Applied Engineering Theories: 
▪	Computer Vision: YOLO12 (Object Detection) and BoT-SORT (Multi-Object Tracking).
▪	Geospatial Informatics: PostGIS Spatial Indexing, Camera Pin-hole Projection Geometry, Spherical Earth Projection, and Traffic Flow Direction Mapping.
▪	Machine Learning: CLIP Feature Embedding, Zero-Shot Classification, and Active Learning Query Strategies (Margin/Uncertainty Query).
▪	Software Engineering: Microservices, Distributed Task Queues (Celery, Redis), Weighted Peer-to-Peer Consensus, and Token-Based Gamification Mechanics.
o	Server-side technology:
▪	FastAPI, NestJS, Celery, Redis, PostgreSQL, PostGIS, pgvector, MinIO
o	Client-side technology:
▪	ReactJS, TypeScript, Tailwind CSS, React Flow, Mapbox GL, Leaflet.js
o	Documents to be delivered:
▪	User Requirements Document (URD) & Software Requirements Specification (SRS)
▪	Software Architecture Document (SAD) & Database Design Document (PostGIS Spatial Schema & ERD)
▪	Active Learning and CLIP Pipeline Design Specification
▪	Testing Specification & Report (Unit, Integration, System, and Load tests)
▪	Deployment Guide (Docker-Compose & Cloud Infrastructure setup)
▪	Product Source Code Repositories & Deployable packages (Docker-Compose configurations, Web static builds).
o	System Processing Pipelines: 
▪	Coordinates background execution of Celery workers parsing large surveyor uploads, aligning telemetry timestamps from companion GPX logs with individual video frames.
▪	Executes parallel YOLO12 neural network inferences to detect traffic signs, followed by BoT-SORT spatial-velocity correlation tracking to cluster sequential frames of the same physical sign and extract the single highest-clarity Best Frame.
▪	Projects physical coordinate estimations utilizing dynamic camera-vehicle distance heuristics, translating vehicle GPS positions onto PostGIS spatial schemas with spherical Earth trigonometry, while deriving traffic flow directions based on trajectory vectors.
▪	Executes periodic background Celery workers to analyze unverified candidate confidence scores, selecting high-uncertainty (beneficial) and high-confidence (rapid-publish) records, and schedules automated retraining queues to optimize YOLO12 and CLIP.
▪	Runs automated cron triggers to evaluate the age metrics of verified spatial records against administrative threshold rules, generating revalidation tasks and pinning them to the global task map.
▪	Processes platform credit transactions for survey rewards, reviewer rewards, revalidation rewards, daily task rewards, premium feature consumption, refunds, and manual credit adjustments.
▪	Verifies top-up payment results from the payment gateway, prevents duplicate payment applications, reconciles payment records with wallet transactions, and applies credits only after successful verification.
▪	Publishes controlled Traffic Sign Catalog versions, synchronizes approved sign types, labeling prompts, and OSM tag mappings with Reviewer workspaces, map filters, and AI classification label sets.
▪	Reprocesses previously unknown, ambiguous, or missing-type candidates after new sign types are approved and added to the official catalog, ensuring that historical candidate data can benefit from taxonomy updates.
●	Fully functional products:
o	Asynchronous Spatio-Temporal Ingestion Engine: Integrated web dashboard featuring chunked uploader queues, telemetry alignment visualizers, and surveyor gamified credit wallets.
o	P2P Reviewer Workspace: Fast-paced, keyboard-hotkey-optimized web interface showing cropped sign assets, calculated traffic directions, map contexts, and contextual original frames.
o	Revalidation Task Portal and Credit Map: Responsive mapping application presenting active revalidation pinboards, detailed task histories, and evidence submissions portals for geo-tagged community media.
o	Interactive GIS Web Dashboard: Fully responsive Leaflet and Mapbox application rendering verified inventories with dynamic grid-based clustering, advanced category filters, and sign orientation arrow headings.
o	Asynchronous MLOps Backend Orchestrator: Core NestJS and FastAPI services managing celery processing workers, Redis message brokers, PostGIS tables, pgvector index updates, and scheduled background AI model fine-tuning tasks.
●	Program:
#	Item
1	Web Application for Admin
1.1	Manage accounts & permissions
1.2	View transaction logs
1.3	Moderate spatial data & overrides
1.4	Configure system parameters
1.5	Manage model retraining pipelines
1.6	Export spatial inventory data
1.7	Manage credit rules, top-up packages, and payment transactions 
1.8	Manage traffic sign catalog, categories, representative images, and labeling guidelines 
1.9	Review missing sign type reports and approve new sign types 
1.10	Configure AI label prompts and OSM tag mappings 
2	Web Workspace for Reviewers
2.1	Load active verification queue
2.2	Review & validate sign candidates
2.3	Flag anomalous or blurry submissions
2.4	Compare revalidation evidence records
2.5	View performance metrics & leaderboard
2.6	Search, filter, and view the traffic sign catalog 
2.7	Select corrected sign labels from the catalog 
2.8	Report missing sign types 
3	Web Portal & Mobile Interface for Surveyors & Drivers
3.1	Register & authenticate user account
3.2	Upload video & GPX telemetry
3.3	Search location & view GIS map
3.4	Discover & navigate revalidation tasks
3.5	Submit task evidence media
3.6	View credits & daily tasks
3.7	Configure profile settings
3.8	Track survey processing status 
3.9	Browse, search, and filter the traffic sign catalog 
3.10	Report missing sign types with evidence 
3.11	Use smart active navigation mode 
3.12	Top up credits 

●	Proposed Tasks for students:
o	Task package 1: AI & Geospatial Pipeline (Assigned to: Leader Phan Tài Đức & Member Nguyễn Long Vũ)
▪	Integrate YOLO12 and BoT-SORT into an asynchronous processing stream.
▪	Build the coordinate-calculation engine that projects vehicle trajectories and estimated distances (d) into PostGIS coordinates.
▪	Design the tracking-based Traffic Flow Direction classification module to automatically identify sign orientation relative to the vehicle's heading path.
▪	Design the Active Learning selection pipeline using CLIP embedding vectors.
o	Task package 2: Enterprise Backend Architecture (Assigned to: Nguyễn Phúc Khang)
▪	Design and implement the FastAPI/NestJS backend services, Celery task distribution queues, PostgreSQL schema (PostGIS spatial queries + pgvector indexing), and secure REST/Websocket APIs.
▪	Implement Role-Based Access Control (RBAC), Authentication, and Gamification engines.
▪	Build the background Freshness Monitor and automated Revalidation Task generator engine.
o	Task package 3: Frontend & Interactive GIS (Assigned to: Nguyễn Lê Quang Hưng)
▪	Build the ReactJS responsive application, map clustering layers using Mapbox/Leaflet, interactive P2P vote review interfaces, and surveyor gamification stats panels.
▪	Implement the Revalidation Task Map, Revalidation Finder dashboard, and evidence upload panels.
▪	Implement navigation simulation with heading-sensitive voice alerts.
o	Task package 4: DevOps, Infrastructure & Testing (Assigned to: All team members)
▪	Set up Docker environments and CI/CD-automated test runs (GitHub Actions).
▪	Write complete software specs (SRS, SDD, Test cases), and measure API/Celery performance under heavy loads.
●	Other products:
-	N/A
4. Other comments (propose all relevant things if any)
……………………………………………….
           
Supervisor (If have)
 (Sign and full name)	Ho Chi Minh City, date 27/05/2026
On behalf of the Registers 
(Sign and full name)
						                                                                   
		                                                         Phan Tài Đức
