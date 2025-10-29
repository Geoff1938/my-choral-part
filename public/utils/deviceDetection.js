/**
 * Device Detection Utilities
 * Functions for detecting device capabilities (memory, mobile, connection)
 */

import { MEMORY } from '../constants.js';

/**
 * Check if the user agent indicates a mobile device
 * @returns {boolean}
 */
export function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
    );
}

/**
 * Get device memory in GB (if available)
 * @returns {number|undefined} Memory in GB, or undefined if API not available
 */
export function getDeviceMemory() {
    return navigator.deviceMemory;
}

/**
 * Check if device has limited memory
 * @returns {boolean}
 */
export function hasLimitedMemory() {
    const deviceMemory = getDeviceMemory();
    const mobile = isMobile();

    // If device memory API available
    if (deviceMemory !== undefined) {
        if (mobile) {
            return deviceMemory <= MEMORY.MOBILE_LOW_MEMORY_GB;
        } else {
            return deviceMemory <= MEMORY.LOW_MEMORY_GB;
        }
    }

    // If no memory API, assume mobile devices are limited
    return mobile;
}

/**
 * Get connection information (if available)
 * @returns {Object|null} Connection info or null
 */
export function getConnectionInfo() {
    if (!navigator.connection) {
        return null;
    }

    return {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt,
        saveData: navigator.connection.saveData
    };
}

/**
 * Check device capabilities and return summary
 * @returns {Object} Device capability information
 */
export function checkDeviceCapabilities() {
    const mobile = isMobile();
    const deviceMemory = getDeviceMemory();
    const limitedMemory = hasLimitedMemory();
    const connection = getConnectionInfo();

    let info = '';
    if (deviceMemory !== undefined) {
        info += `Device Memory: ${deviceMemory}GB`;
    }
    if (mobile) {
        info += (info ? ', ' : '') + 'Mobile Device';
    }
    if (connection) {
        info += (info ? ', ' : '') + `Connection: ${connection.effectiveType}`;
    }

    return {
        isMobile: mobile,
        deviceMemory,
        hasLimitedMemory: limitedMemory,
        connection,
        info: info || 'Unknown device'
    };
}
