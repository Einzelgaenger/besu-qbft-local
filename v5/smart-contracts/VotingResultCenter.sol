// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IRoomFactoryRegistry {
    function isRoom(address room) external view returns (bool);
}

/**
 * @title VotingResultCenter
 * @notice Central storage for published VotingRoom round histories.
 * @dev Each submission from a room creates a new monotonically increasing version.
 */
contract VotingResultCenter is Ownable {
    uint256 public constant MAX_BATCH_SIZE = 500;

    address public roomFactory;

    struct PublishedRound {
        address room;
        uint256 version;
        uint256 roundId;
        address admin;
        uint256 totalVoter;
        uint256 totalGolput;
        uint256 startAt;
        uint256 stopAt;
        bytes32 historyHash;
        uint256 submittedAt;
        uint256[] candidateIds;
        string[] candidateNames;
        uint256[] voteCounts;
    }

    address[] private roomList;
    mapping(address room => bool seen) public hasSubmitted;
    mapping(address room => address admin) public roomAdmin;
    mapping(address room => PublishedRound[] versions) private roomVersions;

    event RoundResultSubmitted(
        address indexed room,
        address indexed admin,
        uint256 indexed version,
        uint256 roundId,
        bytes32 historyHash,
        uint256 submittedAt
    );
    event RoomFactoryUpdated(address indexed oldFactory, address indexed newFactory);

    error ZeroAddress();
    error InvalidAmount();
    error ArrayTooLarge(uint256 provided, uint256 maxAllowed);
    error VersionNotFound(address room, uint256 version);
    error UnregisteredRoom(address room);

    constructor(address _roomFactory) Ownable(msg.sender) {
        if (_roomFactory == address(0)) revert ZeroAddress();
        roomFactory = _roomFactory;
    }

    function setRoomFactory(address newFactory) external onlyOwner {
        if (newFactory == address(0)) revert ZeroAddress();

        address oldFactory = roomFactory;
        roomFactory = newFactory;

        emit RoomFactoryUpdated(oldFactory, newFactory);
    }

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
    ) external returns (uint256 version) {
        if (admin == address(0)) revert ZeroAddress();
        if (candidateIds.length != candidateNames.length || candidateIds.length != voteCounts.length) {
            revert InvalidAmount();
        }
        if (candidateIds.length > MAX_BATCH_SIZE) revert ArrayTooLarge(candidateIds.length, MAX_BATCH_SIZE);

        address room = msg.sender;
        if (!IRoomFactoryRegistry(roomFactory).isRoom(room)) revert UnregisteredRoom(room);

        if (!hasSubmitted[room]) {
            hasSubmitted[room] = true;
            roomAdmin[room] = admin;
            roomList.push(room);
        }

        version = roomVersions[room].length + 1;
        PublishedRound storage published = roomVersions[room].push();
        published.room = room;
        published.version = version;
        published.roundId = roundId;
        published.admin = admin;
        published.totalVoter = totalVoter;
        published.totalGolput = totalGolput;
        published.startAt = startAt;
        published.stopAt = stopAt;
        published.historyHash = historyHash;
        published.submittedAt = block.timestamp;

        for (uint256 i = 0; i < candidateIds.length; i++) {
            published.candidateIds.push(candidateIds[i]);
            published.candidateNames.push(candidateNames[i]);
            published.voteCounts.push(voteCounts[i]);
        }

        emit RoundResultSubmitted(room, admin, version, roundId, historyHash, block.timestamp);
    }

    function getRoomCount() external view returns (uint256) {
        return roomList.length;
    }

    function getRoomAt(uint256 index) external view returns (address) {
        return roomList[index];
    }

    function getRooms() external view returns (address[] memory) {
        return roomList;
    }

    function getRoomWithAdminAt(uint256 index) external view returns (address room, address admin) {
        room = roomList[index];
        admin = roomAdmin[room];
    }

    function getRoomsWithAdmins() external view returns (address[] memory rooms, address[] memory admins) {
        uint256 length = roomList.length;
        rooms = new address[](length);
        admins = new address[](length);

        for (uint256 i = 0; i < length; i++) {
            address room = roomList[i];
            rooms[i] = room;
            admins[i] = roomAdmin[room];
        }
    }

    function getRoomVersionCount(address room) external view returns (uint256) {
        return roomVersions[room].length;
    }

    function getRoomAdmin(address room) external view returns (address) {
        return roomAdmin[room];
    }

    function getRoomVersionSummary(
        address room,
        uint256 version
    )
        external
        view
        returns (
            uint256 roundId,
            address admin,
            uint256 totalVoter,
            uint256 totalGolput,
            uint256 startAt,
            uint256 stopAt,
            bytes32 historyHash,
            uint256 submittedAt
        )
    {
        PublishedRound storage published = _getVersion(room, version);
        return (
            published.roundId,
            published.admin,
            published.totalVoter,
            published.totalGolput,
            published.startAt,
            published.stopAt,
            published.historyHash,
            published.submittedAt
        );
    }

    function getRoomVersionCandidates(
        address room,
        uint256 version
    ) external view returns (uint256[] memory ids, string[] memory names, uint256[] memory voteCounts) {
        PublishedRound storage published = _getVersion(room, version);
        return (published.candidateIds, published.candidateNames, published.voteCounts);
    }

    function getLatestVersion(address room) external view returns (uint256) {
        return roomVersions[room].length;
    }

    function _getVersion(address room, uint256 version) internal view returns (PublishedRound storage) {
        if (version == 0 || version > roomVersions[room].length) revert VersionNotFound(room, version);
        return roomVersions[room][version - 1];
    }
}
