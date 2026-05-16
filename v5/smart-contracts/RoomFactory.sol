// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

interface IVotingRoom {
    function initialize(address _roomAdmin, string calldata _roomName) external;
}

/**
 * @title RoomFactory
 * @notice Factory for creating direct-vote room clones using the EIP-1167 minimal proxy pattern.
 * @dev Room creation has no registration fee and does not depend on SponsorVault or MinimalForwarder.
 */
contract RoomFactory is Ownable {
    address public immutable votingRoomImplementation;

    mapping(address room => address admin) public roomOwner;
    mapping(address room => bool valid) public isRoom;
    address[] public allRooms;

    event RoomRegistered(address indexed room, address indexed admin, string name);

    error RoomCreationFailed();
    error ZeroAddress();

    constructor(address _votingRoomImplementation) Ownable(msg.sender) {
        if (_votingRoomImplementation == address(0)) revert ZeroAddress();
        votingRoomImplementation = _votingRoomImplementation;
    }

    function createRoom(string calldata roomName) external returns (address room) {
        room = Clones.clone(votingRoomImplementation);
        if (room == address(0)) revert RoomCreationFailed();

        IVotingRoom(room).initialize({
            _roomAdmin: msg.sender,
            _roomName: roomName
        });

        roomOwner[room] = msg.sender;
        isRoom[room] = true;
        allRooms.push(room);

        emit RoomRegistered(room, msg.sender, roomName);
    }

    function getRoomCount() external view returns (uint256) {
        return allRooms.length;
    }

    function getRoomAt(uint256 index) external view returns (address) {
        require(index < allRooms.length, "Index out of bounds");
        return allRooms[index];
    }

    function getRoomsByAdmin(address admin) external view returns (address[] memory) {
        uint256 count = 0;

        for (uint256 i = 0; i < allRooms.length; i++) {
            if (roomOwner[allRooms[i]] == admin) {
                count++;
            }
        }

        address[] memory result = new address[](count);
        uint256 resultIndex = 0;

        for (uint256 i = 0; i < allRooms.length; i++) {
            if (roomOwner[allRooms[i]] == admin) {
                result[resultIndex] = allRooms[i];
                resultIndex++;
            }
        }

        return result;
    }

    function getRoomsByVoter(address voter) external view returns (address[] memory rooms) {
        uint256 count = 0;

        for (uint256 i = 0; i < allRooms.length; i++) {
            (bool success, bytes memory result) = allRooms[i].staticcall(
                abi.encodeWithSignature("isVoterEligible(address)", voter)
            );
            if (success && result.length > 0 && abi.decode(result, (bool))) {
                count++;
            }
        }

        address[] memory resultRooms = new address[](count);
        uint256 resultIndex = 0;

        for (uint256 i = 0; i < allRooms.length; i++) {
            (bool success, bytes memory data) = allRooms[i].staticcall(
                abi.encodeWithSignature("isVoterEligible(address)", voter)
            );
            if (success && data.length > 0 && abi.decode(data, (bool))) {
                resultRooms[resultIndex] = allRooms[i];
                resultIndex++;
            }
        }

        return resultRooms;
    }
}
