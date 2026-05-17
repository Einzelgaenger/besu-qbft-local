// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IVotingResultCenter {
    function submitRoundResult(
        uint256 roundId,
        address admin,
        uint256 totalVoter,
        uint256 totalGolput,
        uint256 startAt,
        uint256 stopAt,
        uint256[] calldata candidateIds,
        string[] calldata candidateNames,
        uint256[] calldata voteCounts,
        bytes32 historyHash
    ) external returns (uint256 version);
}

/**
 * @title VotingRoom
 * @notice EIP-1167 compatible direct-vote room with one-voter-one-vote per round.
 * @dev Voters call vote() directly from their own EOA. No relayer, vault, or forwarder is used.
 */
contract VotingRoom is ReentrancyGuard {
    enum State {
        Inactive,
        Active
    }

    uint256 public constant MAX_BATCH_SIZE = 500;

    bool public initialized;

    address public roomAdmin;
    string public roomName;
    address public resultCenter;

    State public state;
    uint256 public currentRound;
    uint256 public activeRoundStartAt;
    bool public roundReadyToStart;

    address[] private voterList;
    mapping(address voter => bool registered) private voterRegistry;
    mapping(address voter => uint256 round) public lastVotedRound;

    uint256[] private candidateIds;
    mapping(uint256 candidateId => bool exists) private candidateRegistry;
    mapping(uint256 candidateId => string name) public candidateName;

    mapping(address voter => uint256 indexPlusOne) private voterIndexPlusOne;
    mapping(uint256 candidateId => uint256 indexPlusOne) private candidateIndexPlusOne;

    mapping(uint256 round => mapping(uint256 candidateId => uint256 votes)) public roundVotes;
    mapping(uint256 round => uint256 totalVotes) public roundTotalVotes;

    struct RoundHistory {
        address room;
        uint256 roundId;
        address admin;
        uint256 totalVoter;
        uint256 totalGolput;
        uint256 startAt;
        uint256 stopAt;
        uint256[] candidateIds;
        string[] candidateNames;
        uint256[] voteCounts;
    }

    mapping(uint256 round => RoundHistory) private roundHistories;
    mapping(uint256 round => bool saved) public roundHistorySaved;

    event RoomInitialized(address indexed admin, string name);
    event RoundStarted(address indexed room, uint256 indexed round, uint256 startAt);
    event RoundStopped(
        address indexed room,
        uint256 indexed round,
        uint256 stopAt,
        uint256 totalVoter,
        uint256 totalGolput
    );
    event RoundRestarted(address indexed room, uint256 indexed round);
    event RoomReset(address indexed room, uint256 indexed round);

    event VoterAdded(address indexed room, address indexed voter);
    event VoterRemoved(address indexed room, address indexed voter);
    event CandidateAdded(address indexed room, uint256 indexed candidateId, string name);
    event CandidateRemoved(address indexed room, uint256 indexed candidateId);
    event VoteCast(
        address indexed room,
        uint256 indexed round,
        address indexed voter,
        uint256 candidateId,
        bytes32 actionId
    );
    event ResultCenterUpdated(address indexed room, address indexed oldCenter, address indexed newCenter);
    event RoundHistorySubmitted(
        address indexed room,
        uint256 indexed round,
        uint256 indexed version,
        bytes32 historyHash,
        address resultCenter
    );

    error AlreadyInitialized();
    error NotInitialized();
    error OnlyRoomAdmin();
    error InvalidState();
    error ZeroAddress();
    error InvalidAmount();
    error ArrayTooLarge(uint256 provided, uint256 maxAllowed);
    error DuplicateVoter(address voter);
    error DuplicateCandidate(uint256 candidateId);
    error VoterNotEligible();
    error VoterNotFound(address voter);
    error CandidateNotFound(uint256 candidateId);
    error AlreadyVotedThisRound();
    error NoVotersConfigured();
    error NoCandidatesConfigured();
    error RoundNotReady();
    error RoundAlreadyPrepared();
    error ResultCenterNotConfigured();
    error RoundHistoryNotSaved(uint256 round);

    modifier onlyAdmin() {
        if (msg.sender != roomAdmin) revert OnlyRoomAdmin();
        _;
    }

    modifier onlyInitialized() {
        if (!initialized) revert NotInitialized();
        _;
    }

    modifier inState(State required) {
        if (state != required) revert InvalidState();
        _;
    }

    modifier onlyInactive() {
        if (state != State.Inactive) revert InvalidState();
        _;
    }

    function initialize(address _roomAdmin, string calldata _roomName) external {
        if (initialized) revert AlreadyInitialized();
        if (_roomAdmin == address(0)) revert ZeroAddress();

        initialized = true;
        roomAdmin = _roomAdmin;
        roomName = _roomName;

        state = State.Inactive;
        currentRound = 1;
        roundReadyToStart = true;

        emit RoomInitialized(_roomAdmin, _roomName);
    }

    function setResultCenter(address newCenter) external onlyInitialized onlyAdmin onlyInactive {
        if (newCenter == address(0)) revert ZeroAddress();

        address oldCenter = resultCenter;
        resultCenter = newCenter;

        emit ResultCenterUpdated(address(this), oldCenter, newCenter);
    }

    function addVoter(address voter) external onlyInitialized onlyAdmin {
        _addVoter(voter);
    }

    function addVoters(address[] calldata voters) external onlyInitialized onlyAdmin {
        if (voters.length > MAX_BATCH_SIZE) revert ArrayTooLarge(voters.length, MAX_BATCH_SIZE);
        for (uint256 i = 0; i < voters.length; i++) {
            _addVoter(voters[i]);
        }
    }

    function removeVoter(address voter) external onlyInitialized onlyAdmin onlyInactive {
        _removeVoter(voter);
    }

    function removeAllVoters() external onlyInitialized onlyAdmin onlyInactive {
        _clearAllVoters();
    }

    function addCandidate(uint256 candidateId, string calldata name) external onlyInitialized onlyAdmin onlyInactive {
        _addCandidate(candidateId, name);
    }

    function addCandidates(uint256[] calldata ids, string[] calldata names) external onlyInitialized onlyAdmin onlyInactive {
        if (ids.length != names.length) revert InvalidAmount();
        if (ids.length > MAX_BATCH_SIZE) revert ArrayTooLarge(ids.length, MAX_BATCH_SIZE);
        for (uint256 i = 0; i < ids.length; i++) {
            _addCandidate(ids[i], names[i]);
        }
    }

    function removeCandidate(uint256 candidateId) external onlyInitialized onlyAdmin onlyInactive {
        _removeCandidate(candidateId);
    }

    function removeAllCandidates() external onlyInitialized onlyAdmin onlyInactive {
        _clearAllCandidates();
    }

    function start() external onlyInitialized onlyAdmin onlyInactive {
        if (!roundReadyToStart) revert RoundNotReady();
        if (voterList.length == 0) revert NoVotersConfigured();
        if (candidateIds.length == 0) revert NoCandidatesConfigured();

        activeRoundStartAt = block.timestamp;
        state = State.Active;

        emit RoundStarted(address(this), currentRound, activeRoundStartAt);
    }

    function stop() external onlyInitialized onlyAdmin inState(State.Active) {
        uint256 stopAt = block.timestamp;
        uint256 totalVoter = voterList.length;
        uint256 totalGolput = totalVoter - roundTotalVotes[currentRound];

        RoundHistory storage history = roundHistories[currentRound];
        history.room = address(this);
        history.roundId = currentRound;
        history.admin = roomAdmin;
        history.totalVoter = totalVoter;
        history.totalGolput = totalGolput;
        history.startAt = activeRoundStartAt;
        history.stopAt = stopAt;

        uint256 length = candidateIds.length;
        for (uint256 i = 0; i < length; i++) {
            uint256 candidateId = candidateIds[i];
            history.candidateIds.push(candidateId);
            history.candidateNames.push(candidateName[candidateId]);
            history.voteCounts.push(roundVotes[currentRound][candidateId]);
        }

        roundHistorySaved[currentRound] = true;
        activeRoundStartAt = 0;
        roundReadyToStart = false;
        state = State.Inactive;

        emit RoundStopped(address(this), currentRound, stopAt, totalVoter, totalGolput);
    }

    function restart() external onlyInitialized onlyAdmin onlyInactive {
        if (roundReadyToStart) revert RoundAlreadyPrepared();

        currentRound += 1;
        roundReadyToStart = true;

        emit RoundRestarted(address(this), currentRound);
    }

    function reset() external onlyInitialized onlyAdmin onlyInactive {
        if (roundReadyToStart) revert RoundAlreadyPrepared();

        _clearAllCandidates();
        _clearAllVoters();

        currentRound += 1;
        roundReadyToStart = true;

        emit RoomReset(address(this), currentRound);
    }

    function vote(uint256 candidateId) external onlyInitialized nonReentrant inState(State.Active) {
        address voter = msg.sender;

        if (!voterRegistry[voter]) revert VoterNotEligible();
        if (lastVotedRound[voter] == currentRound) revert AlreadyVotedThisRound();
        if (!candidateRegistry[candidateId]) revert CandidateNotFound(candidateId);

        roundVotes[currentRound][candidateId] += 1;
        roundTotalVotes[currentRound] += 1;
        lastVotedRound[voter] = currentRound;

        bytes32 actionId = keccak256(abi.encodePacked(address(this), currentRound, voter));
        emit VoteCast(address(this), currentRound, voter, candidateId, actionId);
    }

    function submitRoundHistory(uint256 round) external onlyInitialized onlyAdmin returns (uint256 version) {
        if (resultCenter == address(0)) revert ResultCenterNotConfigured();
        if (!roundHistorySaved[round]) revert RoundHistoryNotSaved(round);

        RoundHistory storage history = roundHistories[round];
        bytes32 historyHash = getRoundHistoryHash(round);

        version = IVotingResultCenter(resultCenter).submitRoundResult({
            roundId: history.roundId,
            admin: history.admin,
            totalVoter: history.totalVoter,
            totalGolput: history.totalGolput,
            startAt: history.startAt,
            stopAt: history.stopAt,
            candidateIds: history.candidateIds,
            candidateNames: history.candidateNames,
            voteCounts: history.voteCounts,
            historyHash: historyHash
        });

        emit RoundHistorySubmitted(address(this), round, version, historyHash, resultCenter);
    }

    function isVoterEligible(address voter) external view returns (bool) {
        return voterRegistry[voter];
    }

    function isCandidateValid(uint256 candidateId) external view returns (bool) {
        return candidateRegistry[candidateId];
    }

    function getVotes(uint256 round, uint256 candidateId) external view returns (uint256) {
        return roundVotes[round][candidateId];
    }

    function getVoterCount() external view returns (uint256) {
        return voterList.length;
    }

    function getCandidateCount() external view returns (uint256) {
        return candidateIds.length;
    }

    function getVoters() external view returns (address[] memory) {
        return voterList;
    }

    function getCandidates() external view returns (uint256[] memory ids, string[] memory names) {
        uint256 length = candidateIds.length;
        ids = new uint256[](length);
        names = new string[](length);

        for (uint256 i = 0; i < length; i++) {
            uint256 candidateId = candidateIds[i];
            ids[i] = candidateId;
            names[i] = candidateName[candidateId];
        }
    }

    function getRoundHistory(
        uint256 round
    )
        external
        view
        returns (
            address room,
            uint256 roundId,
            address admin,
            uint256 totalVoter,
            uint256 totalGolput,
            uint256 startAt,
            uint256 stopAt
        )
    {
        RoundHistory storage history = roundHistories[round];
        return (
            history.room,
            history.roundId,
            history.admin,
            history.totalVoter,
            history.totalGolput,
            history.startAt,
            history.stopAt
        );
    }

    function getRoundHistoryCandidates(
        uint256 round
    ) external view returns (uint256[] memory ids, string[] memory names, uint256[] memory voteCounts) {
        RoundHistory storage history = roundHistories[round];
        return (history.candidateIds, history.candidateNames, history.voteCounts);
    }

    function getRoundHistoryHash(uint256 round) public view returns (bytes32) {
        if (!roundHistorySaved[round]) revert RoundHistoryNotSaved(round);

        RoundHistory storage history = roundHistories[round];
        return keccak256(
            abi.encode(
                history.room,
                history.roundId,
                history.admin,
                history.totalVoter,
                history.totalGolput,
                history.startAt,
                history.stopAt,
                history.candidateIds,
                history.candidateNames,
                history.voteCounts
            )
        );
    }

    function getCurrentRoundStatus()
        external
        view
        returns (uint256 roundId, State roomState, bool readyToStart, uint256 startAt)
    {
        return (currentRound, state, roundReadyToStart, activeRoundStartAt);
    }

    function _addVoter(address voter) internal {
        if (voter == address(0)) revert ZeroAddress();
        if (voterRegistry[voter]) revert DuplicateVoter(voter);

        voterRegistry[voter] = true;
        voterList.push(voter);
        voterIndexPlusOne[voter] = voterList.length;

        emit VoterAdded(address(this), voter);
    }

    function _removeVoter(address voter) internal {
        uint256 indexPlusOne = voterIndexPlusOne[voter];
        if (indexPlusOne == 0) revert VoterNotFound(voter);

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = voterList.length - 1;

        if (index != lastIndex) {
            address movedVoter = voterList[lastIndex];
            voterList[index] = movedVoter;
            voterIndexPlusOne[movedVoter] = index + 1;
        }

        voterList.pop();
        delete voterRegistry[voter];
        delete voterIndexPlusOne[voter];

        emit VoterRemoved(address(this), voter);
    }

    function _addCandidate(uint256 candidateId, string calldata name) internal {
        if (candidateRegistry[candidateId]) revert DuplicateCandidate(candidateId);

        candidateRegistry[candidateId] = true;
        candidateName[candidateId] = name;
        candidateIds.push(candidateId);
        candidateIndexPlusOne[candidateId] = candidateIds.length;

        emit CandidateAdded(address(this), candidateId, name);
    }

    function _removeCandidate(uint256 candidateId) internal {
        uint256 indexPlusOne = candidateIndexPlusOne[candidateId];
        if (indexPlusOne == 0) revert CandidateNotFound(candidateId);

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = candidateIds.length - 1;

        if (index != lastIndex) {
            uint256 movedCandidateId = candidateIds[lastIndex];
            candidateIds[index] = movedCandidateId;
            candidateIndexPlusOne[movedCandidateId] = index + 1;
        }

        candidateIds.pop();
        delete candidateRegistry[candidateId];
        delete candidateIndexPlusOne[candidateId];
        delete candidateName[candidateId];

        emit CandidateRemoved(address(this), candidateId);
    }

    function _clearAllCandidates() internal {
        uint256 length = candidateIds.length;
        for (uint256 i = 0; i < length; i++) {
            uint256 candidateId = candidateIds[i];
            delete candidateRegistry[candidateId];
            delete candidateIndexPlusOne[candidateId];
            delete candidateName[candidateId];
            emit CandidateRemoved(address(this), candidateId);
        }
        delete candidateIds;
    }

    function _clearAllVoters() internal {
        uint256 length = voterList.length;
        for (uint256 i = 0; i < length; i++) {
            address voter = voterList[i];
            delete voterRegistry[voter];
            delete voterIndexPlusOne[voter];
            emit VoterRemoved(address(this), voter);
        }
        delete voterList;
    }
}
