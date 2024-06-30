#!/bin/bash

# Define ANSI escape codes for colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m\n'

cd /home/container

# Make internal Docker IP address available to processes.
export INTERNAL_IP=`ip route get 1 | awk '{print $(NF-2);exit}'`


echo "Modding Framework is set to: ${FRAMEWORK}"

if [ -z ${MODDING_ROOT} ]; then
    if [[ "${FRAMEWORK}" =~ "carbon" ]]; then
        MODDING_ROOT="carbon"
    elif [[ "${FRAMEWORK}" =~ "oxide" ]]; then
        MODDING_ROOT="oxide"
    fi
fi

###########################################
# MODDING ROOT FOLDER COMPATIBILITY CHECK #
###########################################

echo "Checking MODDING ROOT DIRECTORY folder compatibility with selected framework"
# Check if carbon framework is being used, and if it is, make sure that the MODDING_ROOT contains the word carbon
if [[ "${FRAMEWORK}" =~ "carbon" ]] && [[ ! "${MODDING_ROOT}" =~ "carbon" ]]; then
    printf "${RED}ERROR: Your framework is ${FRAMEWORK} but your MODDING ROOT DIRECTORY folder does not contain the word \"carbon\". Please change the MODDING ROOT DIRECTORY variable to contain the word \"carbon\" for compatibility reasons.${NC}"
    exit 1
fi

# Do the same for oxide
if [[ "${FRAMEWORK}" =~ "oxide" ]] && [[ ! "${MODDING_ROOT}" =~ "oxide" ]]; then
    printf "${RED}ERROR: Your framework is ${FRAMEWORK} but your MODDING ROOT DIRECTORY folder does not contain the word \"oxide\". Please change the MODDING ROOT DIRECTORY variable to contain the word \"oxide\" for compatibility reasons.${NC}"
    exit 1
fi

printf "${GREEN}Compatibility check passed...${NC}"

# Checking Carbon Root Directory Issues
if [[ "${FRAMEWORK}" =~ "carbon" ]]; then
    printf "${BLUE}Carbon framework detected!${NC}"
    echo "Checking the carbon root directory structure..."
    if [ -d ${MODDING_ROOT} ]; then
        printf "${GREEN}${MODDING_ROOT} folder already exists... Skipping this part.${NC}"
    else
        if [ ! -d "carbon" ] && [ "${MODDING_ROOT}" != "carbon" ]; then
            printf "${RED}Carbon default root directory folder does not exist. Please change your Modding Root Directory folder name to \"carbon\", and restart your server.${NC}"
            exit 1
        elif [ ! -d "carbon" ] && [ "${MODDING_ROOT}" == "carbon" ]; then
            printf "${YELLOW}${MODDING_ROOT} is set as the MODDING ROOT DIRECTORY folder, however it doesn't exist. It will be created after server validation.${NC}"
        else
            printf "${YELLOW}${MODDING_ROOT} folder does not exist. Creating new folder...${NC}"
            mkdir -p /home/container/${MODDING_ROOT}
            echo "Copying files and folders from default carbon directory."
            cp -r /home/container/carbon/* ${MODDING_ROOT}
            printf "${GREEN}Files copied. Moving on...${NC}"
        fi
    fi
fi

# Clean Up Files from Oxide to Vanilla/Carbon Switch
if [[ "${FRAMEWORK}" != "oxide" ]] || [[ "${FRAMEWORK}" != "oxide-staging" ]]; then
    printf "${BLUE}Modding framework is not set to Oxide. Checking if there are left over Oxide files in the server.${NC}"
    shopt -s nullglob
    # Check if the Oxide.dll files exist
    files=(/home/container/RustDedicated_Data/Managed/Oxide.*.dll)
    if [ ${#files[@]} -gt 0 ]; then
        echo "Oxide Files Found!"
        if [[ "${FRAMEWORK}" =~ "carbon" ]]; then
            # Check to see if any Oxide extensions need to be moved
            echo "Carbon framework detected! Moving Oxide Extentions if the exist."
            files=(/home/container/RustDedicated_Data/Managed/Oxide.Ext.*.dll)
            if [ ${#files[@]} -gt 0 ]; then
                printf "${BLUE}Oxide extensions located. Moving files to Modding Directory Extensions Folder.${NC}"
                # Create the extensions folder again if it doesn't exist
                mkdir -p /home/container/${MODDING_ROOT}/extensions/
                # Move the files
                mv -v /home/container/RustDedicated_Data/Managed/Oxide.Ext.*.dll /home/container/${MODDING_ROOT}/extensions/
                printf "${GREEN}Move files has completed successfully!${NC}"
            else
                printf "${GREEN}No Oxide Extensions to Move... Skipping the move...${NC}"
            fi
        else
            printf "${YELLOW}${FRAMEWORK} does not support Oxide Extensions. If you see this and your framework isn't vanilla, then contact the developers.${NC}"
        fi
        # Clean up the rust dedicated managed folder
        echo "Cleaning up RustDedicated_Data/Managed folder..."
        rm -rf RustDedicated_Data/Managed/*
        echo "Removing Oxide Compiler..."
        rm -rf Oxide.Compiler
        printf "${GREEN}Oxide files have been cleaned up!${NC}"
    else
        printf "${GREEN}No Oxide files found to remove - continuing startup...${NC}"
    fi
    shopt -u nullglob
fi


########################
# AUTO UPDATE/VALIDATE #
########################

if [ -z "${AUTO_UPDATE}" ] || [ "${AUTO_UPDATE}" == "1" ]; then
    if [ "${VALIDATE}" == "1" ]; then
        if [ "${FRAMEWORK}" == "oxide-staging" ] || [ "${FRAMEWORK}" == "carbon-staging" ]; then
            echo -e "Validating staging server game files..."
            ./steamcmd/steamcmd.sh +force_install_dir /home/container +login anonymous +app_update 258550 -beta staging validate +quit
        else
            echo -e "Updating game server..."
            ./steamcmd/steamcmd.sh +force_install_dir /home/container +login anonymous +app_update 258550 validate +quit
        fi
    else
        if [ "${FRAMEWORK}" == "oxide-staging" ] || [ "${FRAMEWORK}" == "carbon-staging" ]; then
            echo -e "Updating staging server, not validating..."
            ./steamcmd/steamcmd.sh +force_install_dir /home/container +login anonymous +app_update 258550 -beta staging +quit
        else
            echo -e "Updating game server..."
            ./steamcmd/steamcmd.sh +force_install_dir /home/container +login anonymous +app_update 258550 +quit
        fi
    fi
else
    printf "${YELLOW} Not updating server, auto update set to false.${NC}"
fi


# Replace Startup Variables
MODIFIED_STARTUP=$(eval echo "${STARTUP}" | sed -e 's/{{/${/g' -e 's/}}/}/g')
echo ":/home/container$ ${MODIFIED_STARTUP}"


if [[ "$OXIDE" == "1" ]] || [[ "${FRAMEWORK}" == "oxide" ]]; then
    if [[ "$FRAMEWORK_UPDATE" == "1" ]]; then
        # Oxide: https://github.com/OxideMod/Oxide.Rust
        echo "Updating uMod..."
        curl -sSL "https://github.com/OxideMod/Oxide.Rust/releases/latest/download/Oxide.Rust-linux.zip" > umod.zip
        unzip -o -q umod.zip
        rm umod.zip
        echo "Done updating uMod!"
    else
        printf "${RED}Skipping framework auto update! Did you mean to do this? If not set the Framework Update variable to true!${NC}"
    fi

elif [[ "${FRAMEWORK}" == "oxide-staging" ]]; then
    if [[ "$FRAMEWORK_UPDATE" == "1" ]]; then
        # Oxide: https://github.com/OxideMod/Oxide.Rust
        echo "Updating uMod Staging..."
        curl -sSL "https://downloads.oxidemod.com/artifacts/Oxide.Rust/staging/Oxide.Rust-linux.zip" > umod.zip
        unzip -o -q umod.zip
        rm umod.zip
        echo "Done updating uMod!"
    else
        printf "${RED}Skipping framework auto update! Did you mean to do this? If not set the Framework Update variable to true!${NC}"
    fi


elif [[ "${FRAMEWORK}" == "carbon" ]]; then
    if [[ "$FRAMEWORK_UPDATE" == "1" ]]; then
        # Carbon: https://github.com/CarbonCommunity/Carbon.Core
        echo "Updating Carbon..."
        curl -sSL "https://github.com/CarbonCommunity/Carbon.Core/releases/download/production_build/Carbon.Linux.Release.tar.gz" | tar zx
        echo "Done updating Carbon!"
    else
        printf "${RED}Skipping framework auto update! Did you mean to do this? If not set the Framework Update variable to true!${NC}"
    fi

    export DOORSTOP_ENABLED=1
    export DOORSTOP_TARGET_ASSEMBLY="$(pwd)/${MODDING_ROOT}/managed/Carbon.Preloader.dll"
    MODIFIED_STARTUP="LD_PRELOAD=$(pwd)/libdoorstop.so ${MODIFIED_STARTUP}"

elif [[ "${FRAMEWORK}" == "carbon-edge" ]]; then
    if [[ "$FRAMEWORK_UPDATE" == "1" ]]; then
        # Carbon: https://github.com/CarbonCommunity/Carbon.Core
        echo "Updating Carbon Edge..."
        curl -sSL "https://github.com/CarbonCommunity/Carbon/releases/download/edge_build/Carbon.Linux.Debug.tar.gz" | tar zx
        echo "Done updating Carbon!"
    else
        printf "${RED}Skipping framework auto update! Did you mean to do this? If not set the Framework Update variable to true!${NC}"
    fi

    export DOORSTOP_ENABLED=1
    export DOORSTOP_TARGET_ASSEMBLY="$(pwd)/${MODDING_ROOT}/managed/Carbon.Preloader.dll"
    MODIFIED_STARTUP="LD_PRELOAD=$(pwd)/libdoorstop.so ${MODIFIED_STARTUP}"

elif [[ "${FRAMEWORK}" == "carbon-staging" ]]; then
    if [[ "$FRAMEWORK_UPDATE" == "1" ]]; then
        # Carbon: https://github.com/CarbonCommunity/Carbon.Core
        echo "Updating Carbon Staging..."
        curl -sSL "https://github.com/CarbonCommunity/Carbon/releases/download/rustbeta_staging_build/Carbon.Linux.Debug.tar.gz" | tar zx
        echo "Done updating Carbon!"
    else
        printf "${RED}Skipping framework auto update! Did you mean to do this? If not set the Framework Update variable to true!${NC}"
    fi

    export DOORSTOP_ENABLED=1
    export DOORSTOP_TARGET_ASSEMBLY="$(pwd)/${MODDING_ROOT}/managed/Carbon.Preloader.dll"
    MODIFIED_STARTUP="LD_PRELOAD=$(pwd)/libdoorstop.so ${MODIFIED_STARTUP}"

# else Vanilla, do nothing
fi

# Fix for Rust not starting
export LD_LIBRARY_PATH=$(pwd)/RustDedicated_Data/Plugins/x86_64:$(pwd)

# Run the Server
node /wrapper.js "${MODIFIED_STARTUP}"
