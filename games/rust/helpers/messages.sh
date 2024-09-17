#!/usr/bin/env bash

source /helpers/colors.sh

###########################################
# Log handlers                           #
###########################################

function LogError() {
    # Don't add `${NC}` to the end of the error string so the entire log is red
    LogMessage "${BOLDRED}[ERROR]${NC}" "${RED}$1"

    # If the second param exists
	if [[ ! -z "$2" ]]; then
		# then we must want to exit the script
		if [[ "$2" == "1" ]]; then
			# Exit with error code
			exit 1
		elif [[ "$2" == "0" ]]; then
			# Exit with no error code
			exit 0
		fi
	fi
}

function Warn() {
    LogMessage "${ORANGE}[WARNING]${NC}" "$1"
}

function Info() {
    LogMessage "${BLUE}[INFO]${NC}" "$1"
}

function Success() {
    LogMessage "${GREEN}[SUCCESS]${NC}" "$1"
}

function Debug() {
	if [[ "${EGG_DEBUG}" == "1" ]]; then
        LogMessage "${PURPLE}[DEBUG]${NC}" "$1"
		echo $1
	fi
}

##########
# Colors #
##########

function Red() {
	printf "${RED}$1 ${NC}"
}

###########################################
# Message helpers                         #
###########################################

function LogMessage() {
    dateString=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    printf "${NC}${dateString}${NC} ${1} ${2}${NC}\n"
}
