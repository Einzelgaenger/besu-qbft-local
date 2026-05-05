// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SimpleVoting {
    struct Candidate {
        string name;
        uint256 votes;
    }

    Candidate[] private candidates;
    uint256 public totalVotes;

    event VoteCast(
        address indexed voter,
        uint256 indexed candidateId,
        string candidateName,
        uint256 candidateVotes,
        uint256 totalVotes
    );

    constructor(string[] memory candidateNames) {
        require(candidateNames.length > 0, "candidate list is empty");

        for (uint256 i = 0; i < candidateNames.length; i++) {
            require(bytes(candidateNames[i]).length > 0, "candidate name is empty");
            candidates.push(Candidate({name: candidateNames[i], votes: 0}));
        }
    }

    function vote(uint256 candidateId) public {
        require(candidateId < candidates.length, "invalid candidate");

        Candidate storage candidate = candidates[candidateId];
        candidate.votes += 1;
        totalVotes += 1;

        emit VoteCast(
            msg.sender,
            candidateId,
            candidate.name,
            candidate.votes,
            totalVotes
        );
    }

    function voteMany(uint256[] calldata candidateIds) external {
        require(candidateIds.length > 0, "empty vote batch");

        for (uint256 i = 0; i < candidateIds.length; i++) {
            vote(candidateIds[i]);
        }
    }

    function candidateCount() external view returns (uint256) {
        return candidates.length;
    }

    function getCandidate(uint256 candidateId)
        external
        view
        returns (string memory name, uint256 votes)
    {
        require(candidateId < candidates.length, "invalid candidate");

        Candidate storage candidate = candidates[candidateId];
        return (candidate.name, candidate.votes);
    }

    function getVotes(uint256 candidateId) external view returns (uint256) {
        require(candidateId < candidates.length, "invalid candidate");
        return candidates[candidateId].votes;
    }

    function getResults()
        external
        view
        returns (string[] memory names, uint256[] memory votes)
    {
        names = new string[](candidates.length);
        votes = new uint256[](candidates.length);

        for (uint256 i = 0; i < candidates.length; i++) {
            names[i] = candidates[i].name;
            votes[i] = candidates[i].votes;
        }
    }
}
